const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { codeManifestForCommit, createLocalKeys, issueReceipt, keyFingerprint, verifySignedReceipt } = require('../out/proof');
const { gitHead, writeEvidenceCommit, pushEvidence } = require('../out/evidence-git');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-git-plumbing-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-git-remote-'));
  execFileSync('git', ['init', '--bare', '-q', bare]);
  execFileSync('git', ['init', '-q', root]);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'Developer');
  git('remote', 'add', 'origin', bare);
  fs.writeFileSync(path.join(root, 'main.go'), 'package main\n');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'note\n');
  git('add', '.'); git('commit', '-qm', 'initial');
  const keys = createLocalKeys();
  return { root, bare, git, keys, destroy() { fs.rmSync(root, { force: true, recursive: true }); fs.rmSync(bare, { force: true, recursive: true }); } };
}
function receiptFor(ctx, head = gitHead(ctx.root)) {
  const manifest = codeManifestForCommit(ctx.root, head);
  return issueReceipt({
    schema: 'pohw-editing-receipt/v2', claim: 'self-attested-editor-behavior', targetCommit: head,
    issuedAt: new Date().toISOString(), keyId: keyFingerprint(ctx.keys.publicKeyPem),
    code: { rootHash: manifest.rootHash, files: manifest.files.length, algorithm: manifest.algorithm },
    metrics: { scorePercent: null, coveragePercent: 0, units: 10, monitoredUnits: 0, algorithm: 'rule-based-v0.1' },
    session: { startedAt: null, endedAt: null, auditTip: '0'.repeat(64) }
  }, ctx.keys.privateKeyPem);
}
test('separate evidence branch preserves staged, unstaged, untracked, HEAD, and working tree', () => {
  const ctx = setup();
  try {
    const first = gitHead(ctx.root);
    // All three types of changes coexist when evidence is written.
    fs.writeFileSync(path.join(ctx.root, 'notes.txt'), 'staged\n');
    ctx.git('add', 'notes.txt');
    fs.writeFileSync(path.join(ctx.root, 'notes.txt'), 'staged plus unstaged\n');
    fs.writeFileSync(path.join(ctx.root, 'untracked.go'), 'package untracked\n');
    const staged = ctx.git('diff', '--cached', '--binary');
    const unstaged = ctx.git('diff', '--binary');
    const status = ctx.git('status', '--porcelain=v1');
    const source = fs.readFileSync(path.join(ctx.root, 'notes.txt'), 'utf8');
    const receipt = receiptFor(ctx);
    const result = writeEvidenceCommit(ctx.root, receipt, ctx.keys.publicKeyPem);
    assert.ok(result.updated);
    assert.equal(gitHead(ctx.root), first);
    assert.equal(ctx.git('status', '--porcelain=v1'), status);
    assert.equal(ctx.git('diff', '--cached', '--binary'), staged);
    assert.equal(ctx.git('diff', '--binary'), unstaged);
    assert.equal(fs.readFileSync(path.join(ctx.root, 'notes.txt'), 'utf8'), source);
    assert.equal(ctx.git('ls-tree', '--name-only', 'refs/pohw/evidence'), 'receipts');
    pushEvidence(ctx.root);
    const actual = ctx.git('show', `refs/pohw/evidence:receipts/${first}.json`);
    verifySignedReceipt(JSON.parse(actual), ctx.keys.publicKeyPem, codeManifestForCommit(ctx.root, first));
    assert.equal(writeEvidenceCommit(ctx.root, receipt, ctx.keys.publicKeyPem).updated, false);
    const reissued = receiptFor(ctx);
    assert.equal(writeEvidenceCommit(ctx.root, reissued, ctx.keys.publicKeyPem).updated, false);
  } finally { ctx.destroy(); }
});
test('source commit snapshots exclude uncommitted edits and evidence is append-only across commits', () => {
  const ctx = setup();
  try {
    const a = gitHead(ctx.root);
    const am = codeManifestForCommit(ctx.root, a);
    fs.appendFileSync(path.join(ctx.root, 'main.go'), 'func changed() {}\n');
    assert.equal(codeManifestForCommit(ctx.root, a).rootHash, am.rootHash);
    ctx.git('add', 'main.go');
    ctx.git('commit', '-qm', 'code change');
    const b = gitHead(ctx.root);
    const br = receiptFor(ctx, b);
    const ar = receiptFor(ctx, a);
    assert.notEqual(am.rootHash, codeManifestForCommit(ctx.root, b).rootHash);
    assert.throws(() => verifySignedReceipt(ar, ctx.keys.publicKeyPem, codeManifestForCommit(ctx.root, b)), /Code content/);
    writeEvidenceCommit(ctx.root, ar, ctx.keys.publicKeyPem);
    writeEvidenceCommit(ctx.root, br, ctx.keys.publicKeyPem);
    pushEvidence(ctx.root);
    assert.match(ctx.git('show', `refs/pohw/evidence:receipts/${a}.json`), new RegExp(a));
    assert.match(ctx.git('show', `refs/pohw/evidence:receipts/${b}.json`), new RegExp(b));
  } finally { ctx.destroy(); }
});