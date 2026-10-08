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
  const shown = [];
  let bar = null;
  const disposable = () => ({ dispose() {} });
  const vscode = {
    Uri: { joinPath: (base, name) => uri(base.fsPath + '/' + name) },
    RelativePattern: class { constructor() {} },
    StatusBarAlignment: { Left: 1 },
    FileSystemError: class FileSystemError extends Error { constructor(code) { super(code); this.code = code; } },
    commands: { registerCommand(name, callback) { commands[name] = callback; return disposable(); } },
    window: {
      createStatusBarItem() { bar = { text: '', tooltip: '', command: '', show() {}, dispose() {} }; return bar; },
      showInformationMessage() {}, showWarningMessage() {},
      async showTextDocument(document) { shown.push(document); }
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
    assert.match(shown.at(-1).content, /Human editing evidence score/);
    assert.match(shown.at(-1).content, /Monitored coverage/);
    assert.match(shown.at(-1).content, /example\.ts/);
    await commands['pohw.stop']();
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
