const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function uri(path) {
  return { scheme: 'file', fsPath: path, toString: () => 'file://' + path };
}

test('extension end-to-end: start → edit → save → report → stop and local persistence', async () => {
  const root = uri('/workspace');
  const file = uri('/workspace/example.ts');
  const storage = uri('/storage');
  const disk = new Map([[file.fsPath, 'const baseline = 1;\n']]);
  const written = new Map();
  const listeners = {};
  const commands = {};
  const panels = [];
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
      showInformationMessage() {}, showWarningMessage() {},
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
    const context = { globalStorageUri: storage, subscriptions: [] };
    await extension.activate(context);
    assert.ok(commands['pohw.start']);
    assert.match(bar.text, /Paused/);
    await commands['pohw.start']();
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
    assert.equal(written.size, 1);
    const stored = JSON.parse([...written.values()][0]);
    assert.ok(stored.seq >= 3);
    assert.equal(stored.files[0].path, 'example.ts');
    for (const sub of context.subscriptions) sub.dispose?.();
  } finally {
    Module._load = originalLoad;
  }
});