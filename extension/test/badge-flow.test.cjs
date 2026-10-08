const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const Module = require('node:module');

const uri = p => ({ scheme: 'file', fsPath: p, toString: () => 'file://' + p });
const dispose = () => ({ dispose() {} });

test('badge end to end: VS Code init -> human edit -> stop -> local receipt -> standalone verification', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-badge-extension-'));
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-private-key-'));
  const source = path.join(root, 'main.ts');
  const git = (...args) => execFileSync('git', args, { cwd: root });
  fs.writeFileSync(source, 'const baseline = 1;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n');
  git('init', '-q'); git('remote', 'add', 'origin', 'https://github.com/example/demo.git');
  git('add', 'main.ts', 'README.md');
  const callbacks = {}, commands = {}, errors = [];
  const vscode = {
    Uri: { joinPath: (base, leaf) => uri(path.join(base.fsPath, leaf)) },
    RelativePattern: class { constructor() {} },
    StatusBarAlignment: { Left: 1 },
    FileSystemError: class extends Error { constructor(code) { super(code); this.code = code; } },
    commands: { registerCommand(name, fn) { commands[name] = fn; return dispose(); } },
    window: {
      createStatusBarItem() { return { show() {}, dispose() {}, text: '', tooltip: '', command: '' }; },
      showInformationMessage() {}, showWarningMessage() {}, showErrorMessage(text) { errors.push(text); },
      async showInputBox() { return 'main'; }, async showTextDocument() {}
    },
    workspace: {
      workspaceFolders: [{ uri: uri(root) }], textDocuments: [],
      getConfiguration() { return { get(_, fallback) { return fallback; } }; },
      async findFiles() {
        const names = ['main.ts', 'README.md', '.github/workflows/pohw-verify.yml'];
        return names.map(f => path.join(root, f)).filter(f => fs.existsSync(f)).map(uri);
      },
      fs: {
        async readFile(u) {
          try { return fs.readFileSync(u.fsPath); }
          catch (e) { if (e.code === 'ENOENT') throw new vscode.FileSystemError('FileNotFound'); throw e; }
        },
        async writeFile(u, data) { fs.writeFileSync(u.fsPath, data); },
        async createDirectory(u) { fs.mkdirSync(u.fsPath, { recursive: true }); }
      },
      createFileSystemWatcher() { return { ...dispose(), onDidChange: () => dispose(), onDidCreate: () => dispose(), onDidDelete: () => dispose() }; },
      onDidChangeTextDocument(fn) { callbacks.change = fn; return dispose(); },
      onDidSaveTextDocument(fn) { callbacks.save = fn; return dispose(); },
      onDidOpenTextDocument(fn) { callbacks.open = fn; return dispose(); },
      async openTextDocument(o) { return o; }
    }
  };
  const original = Module._load;
  Module._load = function(name, parent, isMain) { return name === 'vscode' ? vscode : original.call(this, name, parent, isMain); };
  try {
    const { activate } = require('../out/extension');
    const context = { extensionPath: path.join(__dirname, '..'), globalStorageUri: uri(storage), subscriptions: [] };
    await activate(context);
    assert.equal(typeof commands['pohw.enableBadge'], 'function');
    await commands['pohw.enableBadge']();
    assert.deepEqual(errors, []);
    for (const f of ['.pohw/public-key.pem', '.pohw/proof.js', '.pohw/verify.cjs', '.github/workflows/pohw-verify.yml']) {
      assert.ok(fs.existsSync(path.join(root, f)), f);
    }
    const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(md, /PoHW Editing Score/);
    await commands['pohw.enableBadge']();
    assert.equal((fs.readFileSync(path.join(root, 'README.md'), 'utf8').match(/<!-- pohw-badges:start -->/g) || []).length, 1);
    await commands['pohw.start']();
    const old = fs.readFileSync(source, 'utf8');
    const addition = 'const humanEdited = 2;\n';
    const doc = { uri: uri(source), isDirty: true, getText: () => old + addition };
    callbacks.change({ document: doc, contentChanges: [{ rangeOffset: old.length, rangeLength: 0, text: addition }] });
    fs.writeFileSync(source, doc.getText()); doc.isDirty = false; callbacks.save(doc);
    await commands['pohw.stop']();
    assert.deepEqual(errors, []);
    const receipt = path.join(root, '.pohw/receipt.json');
    assert.ok(fs.existsSync(receipt));
    const verify = () => spawnSync(process.execPath, [path.join(root, '.pohw/verify.cjs'), root, path.join(root, 'verified-summary.json')], { encoding: 'utf8' });
    let result = verify();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /verified/);
    const summary = JSON.parse(fs.readFileSync(path.join(root, 'verified-summary.json')));
    assert.ok(summary.humanScore > 0);
    assert.ok(summary.monitoredCoverage > 0);
    assert.equal(summary.assurance, 'self-attested');
    fs.appendFileSync(source, '// unrecorded change\n');
    result = verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FAILED/);
    for (const sub of context.subscriptions) sub.dispose?.();
  } finally {
    Module._load = original;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(storage, { recursive: true, force: true });
  }
});