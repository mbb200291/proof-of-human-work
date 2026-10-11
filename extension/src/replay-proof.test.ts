import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventJournal } from './event-log';
import { commitMetrics, verifyReplayReceipt } from './replay-proof';
import { codeManifestForCommit, createLocalKeys, gitCommitFile, issueReceipt, keyFingerprint, ReceiptBody, verifySignedReceipt, verifiedBadgeSummary } from './proof';

test('independent replay verifies signed commit metrics, redacts source and rejects fabricated scores', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-replay-'));
  const log = path.join(root, 'events.jsonl'); const j = await EventJournal.open(log);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    j.ensure('a.ts', ''); j.session(true, 1000); j.apply('a.ts', { start: 0, deleteCount: 0, insert: 'secretCode' }, 1100);
    fs.writeFileSync(path.join(root, 'a.ts'), 'secretCode'); fs.writeFileSync(path.join(root, 'untracked.ts'), 'baseline');
    git('add', 'a.ts', 'untracked.ts'); git('commit', '-qm', 'source');
    const targetCommit = git('rev-parse', 'HEAD'), manifest = codeManifestForCommit(root, targetCommit);
    const keys = createLocalKeys();
    const metrics = commitMetrics(j.engine, manifest, name => gitCommitFile(root, targetCommit, name));
    const body: ReceiptBody = {
      schema: 'pohw-editing-receipt/v2', claim: 'self-attested-editor-behavior', issuedAt: new Date().toISOString(),
      keyId: keyFingerprint(keys.publicKeyPem), targetCommit,
      code: { algorithm: manifest.algorithm, rootHash: manifest.rootHash, files: manifest.files.length }, metrics,
      session: { startedAt: j.startedAt, endedAt: j.stoppedAt, auditTip: j.tip }, eventLog: j.commitment()
    };
    const receipt = issueReceipt(body, keys.privateKeyPem);
    j.apply('a.ts', { start: 10, deleteCount: 0, insert: 'later' }, 1200);
    const result = await verifyReplayReceipt(root, receipt, keys.publicKeyPem, log);
    assert.equal(result.verification, 'event-chain-and-score-valid');
    assert.equal(result.metrics.scorePercent, 84);
    assert.equal(result.metrics.monitoredUnits, 10);
    assert.equal(result.metrics.units, 18);
    assert.equal(result.files[0].segments[0].score, 0.84);
    assert.equal(JSON.stringify(result).includes('secretCode'), false);
    const publicSummary = verifiedBadgeSummary(receipt, targetCommit);
    assert.equal(publicSummary.scoreVerification, 'not-recomputed');
    assert.equal(JSON.stringify(publicSummary).includes('secretCode'), false);
    const forged = issueReceipt({ ...body, metrics: { ...metrics, scorePercent: 99 } }, keys.privateKeyPem);
    verifySignedReceipt(forged, keys.publicKeyPem, manifest); // arithmetic/signature alone cannot catch this
    await assert.rejects(verifyReplayReceipt(root, forged, keys.publicKeyPem, log), /recomputed metrics/);
    const legacy = { ...body }; delete legacy.eventLog;
    await assert.rejects(verifyReplayReceipt(root, issueReceipt(legacy, keys.privateKeyPem), keys.publicKeyPem, log), /no replay commitment/);
    const mismatched = issueReceipt({ ...body, session: { ...body.session, auditTip: 'f'.repeat(64) } }, keys.privateKeyPem);
    assert.throws(() => verifySignedReceipt(mismatched, keys.publicKeyPem, manifest), /commitment/);
    const partial = commitMetrics(j.engine, manifest, name => gitCommitFile(root, targetCommit, name));
    assert.equal(partial.monitoredUnits, 0); assert.equal(partial.scorePercent, null);
    const receiptFile = path.join(root, 'receipt.json'), keyFile = path.join(root, 'key.pem');
    fs.writeFileSync(receiptFile, JSON.stringify(receipt)); fs.writeFileSync(keyFile, keys.publicKeyPem);
    const cli = path.resolve(__dirname, '../scripts/verify-event-log.cjs');
    const output = execFileSync(process.execPath, [cli, root, receiptFile, keyFile, log], { encoding: 'utf8' });
    assert.equal(JSON.parse(output).verification, 'event-chain-and-score-valid');
  } finally { j.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
