const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const Module = require('node:module');

const uri = p => ({ scheme: 'file', fsPath: p, toString: () => 'file://' + p });
const dispose = () => ({ dispose() {} });

test('badge end to end: init -> code commit -> separate evidence push -> standalone verifier', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-badge-extension-'));
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-private-key-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-origin-bare-'));
  const source = path.join(root, 'main.ts');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  fs.writeFileSync(source, 'const baseline = 1;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git('init', '-q');
  git('config', 'user.name', 'Developer'); git('config', 'user.email', 'dev@example.com');
  git('remote', 'add', 'origin', 'https://github.com/example/demo.git');
  git('config', `url.file://${bare}.insteadOf`, 'https://github.com/example/demo.git');
  git('add', 'main.ts', 'README.md'); git('commit', '-qm', 'initial');
  const callbacks = {}, commands = {}, errors = [];
  const vscode = {
    Uri: { joinPath: (base, leaf) => uri(path.join(base.fsPath, leaf)) },
    RelativePattern: class { constructor() {} }, StatusBarAlignment: { Left: 1 },
    ViewColumn: { Active: -1 },
    FileSystemError: class extends Error { constructor(code) { super(code); this.code = code; } },
    commands: { registerCommand(name, fn) { commands[name] = fn; return dispose(); } },
    window: {
      createStatusBarItem() { return { show() {}, dispose() {}, text: '', tooltip: '', command: '' }; },
      showInformationMessage() {}, showWarningMessage() { return Promise.resolve('Update PoHW File'); },
      showErrorMessage(text) { errors.push(text); },
      async showInputBox() { return 'main'; },
      createWebviewPanel() { return { webview: { html: '' }, reveal() {}, onDidDispose() { return dispose(); }, dispose() {} }; }
    },
    workspace: {
      workspaceFolders: [{ uri: uri(root) }], textDocuments: [],
      getConfiguration() { return { get(_, fallback) { return fallback; } }; },
      async findFiles() {
        return ['main.ts', 'README.md', '.github/workflows/pohw-verify.yml']
          .map(f => path.join(root, f)).filter(f => fs.existsSync(f)).map(uri);
      },
      fs: {
        async readFile(u) { try { return fs.readFileSync(u.fsPath); }
          catch (e) { if (e.code === 'ENOENT') throw new vscode.FileSystemError('FileNotFound'); throw e; } },
        async writeFile(u, data) { fs.writeFileSync(u.fsPath, data); },
        async createDirectory(u) { fs.mkdirSync(u.fsPath, { recursive: true }); }
      },
      createFileSystemWatcher() { return { ...dispose(), onDidChange: () => dispose(), onDidCreate: () => dispose(), onDidDelete: () => dispose() }; },
      onDidChangeTextDocument(fn) { callbacks.change = fn; return dispose(); },
      onDidSaveTextDocument(fn) { callbacks.save = fn; return dispose(); },
      onDidOpenTextDocument(fn) { callbacks.open = fn; return dispose(); }
    }
  };
  const original = Module._load;
  let context;
  Module._load = function(name, parent, isMain) { return name === 'vscode' ? vscode : original.call(this, name, parent, isMain); };
  try {
    const { activate } = require('../out/extension');
    context = { extensionPath: path.join(__dirname, '..'), globalStorageUri: uri(storage), subscriptions: [] };
    await activate(context);
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
    assert.ok(!fs.existsSync(path.join(root, '.pohw/receipt.json')), 'Stop must not write old worktree receipt');
    // Source code and first-time setup are committed normally by developer.
    git('add', '.'); git('commit', '-qm', 'add PoHW + code');
    const target = git('rev-parse', 'HEAD');
    // Simulate partially staged and unrelated unstaged changes after source commit.
    fs.appendFileSync(path.join(root, 'README.md'), '\nnot committed yet\n');
    git('add', 'README.md');
    fs.appendFileSync(path.join(root, 'README.md'), '\nsecond unstaged edit\n');
    const staged = git('diff', '--cached'); const unstaged = git('diff');
    // A normal source commit is detected automatically; no separate PoHW commit command.
    await context.subscriptions[0].pollCommitEvidence();
    assert.deepEqual(errors, []);
    // Manual sync remains a harmless recovery operation.
    await commands['pohw.syncEvidence']();
    assert.deepEqual(errors, []);
    assert.equal(git('rev-parse', 'HEAD'), target);
    assert.equal(git('diff', '--cached'), staged);
    assert.equal(git('diff'), unstaged);
    const evidencePath = `receipts/${target}.json`;
    const receipt = path.join(root, 'receipt-test-only.json');
    fs.writeFileSync(receipt, git('show', `refs/pohw/evidence:${evidencePath}`));
    const verify = () => spawnSync(process.execPath, [path.join(root, '.pohw/verify.cjs'), root, receipt, path.join(root, 'verified-summary.json')], { encoding: 'utf8' });
    let result = verify();
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(fs.readFileSync(path.join(root, 'verified-summary.json')));
    assert.ok(summary.monitoredCoverage > 0);
    assert.equal(summary.sourceCommit, target);
    assert.equal(summary.assurance, 'self-attested');
    fs.writeFileSync(receipt, fs.readFileSync(receipt, 'utf8').replace('self-attested-editor-behavior', 'tampered'));
    result = verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FAILED/);
  } finally {
    context?.subscriptions.forEach(x => x.dispose?.());
    Module._load = original;
    for (const d of [root, storage, bare]) fs.rmSync(d, { recursive: true, force: true });
  }
});