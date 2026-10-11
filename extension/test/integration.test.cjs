const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function uri(path) {
  return { scheme: 'file', fsPath: path, toString: () => 'file://' + path };
}

test('extension end-to-end: start → edit → save → report → stop and local persistence', async () => {
  const root = uri('/workspace');
  const file = uri('/workspace/example.ts');
  const storage = uri(fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-extension-')));
  const disk = new Map([[file.fsPath, 'const baseline = 1;\n']]);
  const written = new Map();
  const listeners = {};
  const commands = {};
  const panels = [];
  const errors = [];
  const warnings = [];
  let bar = null;
  const disposable = () => ({ dispose() {} });
  const vscode = {
    Uri: { joinPath: (base, name) => uri(base.fsPath + '/' + name) },
    RelativePattern: class { constructor() {} },
    StatusBarAlignment: { Left: 1 },
    ViewColumn: { Active: -1 },
    FileSystemError: class FileSystemError extends Error { constructor(code) { super(code); this.code = code; } },
    commands: { registerCommand(name, callback) { commands[name] = callback; return disposable(); } },
    window: {
      createStatusBarItem() { bar = { text: '', tooltip: '', command: '', show() {}, dispose() {} }; return bar; },
      showInformationMessage() {}, showWarningMessage(text) { warnings.push(text); }, showErrorMessage(text) { errors.push(text); },
      createWebviewPanel(type, title, column, options) {
        const panel = {
          type, title, column, options, webview: { html: '' }, revealCount: 0,
          reveal() { this.revealCount++; },
          onDidDispose(callback) { this.disposeCallback = callback; return disposable(); },
          dispose() { this.disposeCallback?.(); }
        };
        panels.push(panel);
        return panel;
      }
    },
    workspace: {
      workspaceFolders: [{ uri: root }],
      textDocuments: [],
      getConfiguration() { return { get(_name, fallback) { return fallback; } }; },
      async findFiles() { return [file]; },
      fs: {
        async readFile(u) {
          const result = disk.get(u.fsPath) ?? written.get(u.fsPath);
          if (result === undefined) throw new vscode.FileSystemError('FileNotFound');
          return Buffer.from(result);
        },
        async writeFile(u, data) { written.set(u.fsPath, Buffer.from(data).toString()); },
        async createDirectory() {}
      },
      createFileSystemWatcher() { return { ...disposable(), onDidChange() { return disposable(); }, onDidCreate() { return disposable(); }, onDidDelete() { return disposable(); } }; },
      onDidChangeTextDocument(cb) { listeners.change = cb; return disposable(); },
      onDidOpenTextDocument(cb) { listeners.open = cb; return disposable(); },
      onDidSaveTextDocument(cb) { listeners.save = cb; return disposable(); },
      async openTextDocument(options) { return options; }
    }
  };
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) { return name === 'vscode' ? vscode : originalLoad.call(this, name, parent, isMain); };
  try {
    const extension = require('../out/extension');
    const { sha256, newFile } = require('../out/core');
    const legacyPath = storage.fsPath + '/' + sha256(root.toString()).slice(0, 24) + '.json';
    const legacyFile = newFile('example.ts', disk.get(file.fsPath));
    legacyFile.segments[0].score = 1;
    const legacy = JSON.stringify({ version: 1, root: root.toString(), files: [legacyFile], tip: 'f'.repeat(64), seq: 1234, recentEvents: [] });
    written.set(legacyPath, legacy);
    const context = { globalStorageUri: storage, subscriptions: [] };
    await extension.activate(context);
    assert.ok(commands['pohw.start']);
    assert.match(bar.text, /Paused/);
    assert.ok(warnings.some(text => /Legacy data is retained/.test(text)));
    assert.equal(written.get(legacyPath), legacy);
    await Promise.all([commands['pohw.start'](), commands['pohw.start']()]);
    assert.match(bar.text, /PoHW/);
    const insert = 'const manuallyTyped = 2;\n';
    const old = disk.get(file.fsPath);
    const changed = old + insert;
    const document = { uri: file, isDirty: true, getText: () => changed };
    listeners.change({ document, contentChanges: [{ rangeOffset: old.length, rangeLength: 0, text: insert }] });
    disk.set(file.fsPath, changed);
    document.isDirty = false;
    listeners.save(document);
    await commands['pohw.report']();
    assert.equal(panels.length, 1);
    assert.equal(panels[0].type, 'pohwProvenanceReport');
    assert.equal(panels[0].options.enableScripts, false);
    assert.match(panels[0].webview.html, /Human editing evidence score/);
    assert.match(panels[0].webview.html, /Monitored coverage/);
    assert.match(panels[0].webview.html, /example\.ts/);
    await commands['pohw.report']();
    assert.equal(panels.length, 1, 'report must reuse one read-only Webview, not create an unsaved document');
    panels[0].dispose();
    await commands['pohw.report']();
    assert.equal(panels.length, 2, 'after closing the panel, reopening creates a fresh read-only Webview');
    await commands['pohw.stop']();
    assert.match(panels[1].webview.html, /Status: Paused/);
    assert.match(bar.text, /Paused/);
    const logs = fs.readdirSync(storage.fsPath).filter(n => n.endsWith('.events.jsonl'));
    assert.equal(logs.length, 1, 'complete evidence must be persisted outside the repository');
    const journal = path.join(storage.fsPath, logs[0]);
    const records = fs.readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.slice(1).map(e => e.kind), ['baseline', 'session-start', 'edit', 'save', 'session-stop']);
    assert.equal(records[3].edit.inserted, insert);
    const { replayJournal } = require('../out/event-log');
    const replay = await replayJournal(journal);
    assert.equal(replay.engine.files.get('example.ts').segments.map(s => s.text).join(''), changed);
    assert.match(panels[1].webview.html, /Local event log/);
    assert.match(panels[1].webview.html, /not recomputed/);
    assert.equal(replay.engine.files.get('example.ts').segments[0].score, null, 'legacy score must not survive without evidence');
    assert.deepEqual(errors, []);
    for (const sub of context.subscriptions) sub.dispose?.();
    // Offline writes are journaled on restart and the UI remains paused.
    disk.set(file.fsPath, changed + 'externalSuffix');
    const restored = { globalStorageUri: storage, subscriptions: [] };
    await extension.activate(restored);
    assert.match(bar.text, /Paused/);
    const replay2 = await replayJournal(journal);
    assert.equal(replay2.engine.files.get('example.ts').segments.at(-1).origin, 'external');
    assert.equal(replay2.engine.files.get('example.ts').segments[1].score, replay.engine.files.get('example.ts').segments[1].score);
    for (const sub of restored.subscriptions) sub.dispose?.();
    // Corruption is visible, retained, and blocks both recording and receipts.
    fs.appendFileSync(journal, '{broken');
    const corruptBytes = fs.readFileSync(journal);
    const blocked = { globalStorageUri: storage, subscriptions: [] };
    await extension.activate(blocked);
    assert.match(bar.text, /Evidence Error/);
    await commands['pohw.start']();
    await commands['pohw.syncEvidence']();
    assert.ok(errors.some(text => /receipt issuance blocked/.test(text)));
    assert.deepEqual(fs.readFileSync(journal), corruptBytes);
    for (const sub of blocked.subscriptions) sub.dispose?.();
  } finally {
    Module._load = originalLoad;
    fs.rmSync(storage.fsPath, { recursive: true, force: true });
  }
});