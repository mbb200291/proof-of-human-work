import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { badgeMarkdown, canonicalJson, codeManifest, createLocalKeys, issueReceipt, keyFingerprint, ReceiptBody, updateBadgeReadme, verifySignedReceipt, verifiedBadgeSummary } from './proof';

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-proof-'));
  execFileSync('git', ['init', '-q', root]);
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const x = 1;\n');
  fs.mkdirSync(path.join(root, '.pohw'));
  fs.writeFileSync(path.join(root, '.pohw', 'receipt.json'), '{}');
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'secret.ts'), 'ignored');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  execFileSync('git', ['add', 'a.ts', 'README.md', '.gitignore'], { cwd: root });
  return root;
}
function sample(root: string) {
  const keys = createLocalKeys();
  const manifest = codeManifest(root);
  const body: ReceiptBody = {
    schema: 'pohw-editing-receipt/v1', claim: 'self-attested-editor-behavior', issuedAt: '2026-10-08T12:30:00.000Z',
    keyId: keyFingerprint(keys.publicKeyPem),
    code: { rootHash: manifest.rootHash, files: manifest.files.length, algorithm: manifest.algorithm },
    metrics: { scorePercent: 82.75, coveragePercent: 50, units: 100, monitoredUnits: 50, algorithm: 'rule-based-v0.1' },
    session: { startedAt: null, endedAt: null, auditTip: 'a'.repeat(64) }
  };
  return { keys, manifest, body, receipt: issueReceipt(body, keys.privateKeyPem) };
}
test('signed report validates against exact tracked and pending code tree', () => {
  const root = repository();
  try {
    const { keys, manifest, receipt } = sample(root);
    verifySignedReceipt(receipt, keys.publicKeyPem, manifest);
    const badge = verifiedBadgeSummary(receipt, 'abc123');
    assert.equal(badge.humanScore, 82.75);
    assert.equal(badge.monitoredCoverage, 50);
    assert.equal(badge.assurance, 'self-attested');
    assert.deepEqual(manifest.files.map(x => x.path), ['README.md', 'a.ts']);
    // Changes to excluded evidence files never create an impossible hash cycle.
    fs.writeFileSync(path.join(root, '.pohw/receipt.json'), JSON.stringify(receipt));
    assert.equal(codeManifest(root).rootHash, manifest.rootHash);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('modified code, added source, tampered score, signature and rotated signer all fail', () => {
  const root = repository();
  try {
    const { keys, manifest, receipt } = sample(root);
    const fail = (r: typeof receipt, key = keys.publicKeyPem, m = manifest) => assert.throws(() => verifySignedReceipt(r, key, m));
    fail({ ...receipt, body: { ...receipt.body, metrics: { ...receipt.body.metrics, scorePercent: 99 } } });
    fail({ ...receipt, signature: 'AAAA' });
    fail(receipt, createLocalKeys().publicKeyPem);
    fs.appendFileSync(path.join(root, 'a.ts'), '// edit\n');
    fail(receipt, keys.publicKeyPem, codeManifest(root));
    fs.writeFileSync(path.join(root, 'new.go'), 'package main\n');
    fail(receipt, keys.publicKeyPem, codeManifest(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('malformed receipt metrics are rejected even with a valid signature', () => {
  const root = repository();
  try {
    const { keys, manifest, body } = sample(root);
    const bad = issueReceipt({ ...body, metrics: { ...body.metrics, coveragePercent: 98 } }, keys.privateKeyPem);
    assert.throws(() => verifySignedReceipt(bad, keys.publicKeyPem, manifest), /inconsistent/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('idempotent badges and deterministic JSON canonicalization', () => {
  const md = badgeMarkdown('alice', 'demo', 'main');
  const before = '# Demo\n';
  const once = updateBadgeReadme(before, md);
  assert.equal(updateBadgeReadme(once, md), once);
  assert.match(once, /pohw-badges%2Fsummary\.json/);
  assert.match(once, /actions\/workflows\/pohw-verify\.yml/);
  assert.throws(() => updateBadgeReadme('<!-- pohw-badges:start -->', md), /Malformed/);
  assert.equal(canonicalJson({ b: 2, a: [3, { y: 2, x: 1 }] }), canonicalJson({ a: [3, { x: 1, y: 2 }], b: 2 }));
});