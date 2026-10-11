/** Independent verifier: no VS Code host, persisted scores or local private key required. */
import { EditingEngine, newFile, textOf } from './core';
import { replayJournal } from './event-log';
import { canonicalJson, CodeManifest, codeManifestForCommit, gitCommitFile, ReceiptBody, SignedReceipt, verifySignedReceipt } from './proof';

function committedEngine(engine: EditingEngine, manifest: CodeManifest, read: (file: string) => string | null): EditingEngine {
  return new EditingEngine(manifest.files.map(file => {
    const content = read(file.path);
    if (content === null) throw new Error(`Unsupported Git content: ${file.path}`);
    const tracked = engine.files.get(file.path);
    return tracked && textOf(tracked) === content ? tracked : newFile(file.path, content);
  }));
}
export function commitMetrics(engine: EditingEngine, manifest: CodeManifest, read: (file: string) => string | null): ReceiptBody['metrics'] {
  const report = committedEngine(engine, manifest, read).report();
  return {
    scorePercent: report.score === null ? null : Math.round(report.score * 10000) / 100,
    coveragePercent: Math.round(report.coverage * 10000) / 100,
    units: report.units, monitoredUnits: report.verifiedUnits, algorithm: 'rule-based-v0.1'
  };
}
export async function verifyReplayReceipt(root: string, receipt: SignedReceipt, publicKey: string, journal: string) {
  const manifest = codeManifestForCommit(root, receipt.body.targetCommit);
  verifySignedReceipt(receipt, publicKey, manifest);
  if (!receipt.body.eventLog) throw new Error('Receipt has no replay commitment; only signature/content verification is available');
  const replay = await replayJournal(journal, receipt.body.eventLog);
  if (receipt.body.session.startedAt !== replay.startedAt || receipt.body.session.endedAt !== replay.stoppedAt) throw new Error('Receipt session metadata differs from event log');
  const read = (file: string) => gitCommitFile(root, receipt.body.targetCommit, file);
  const engine = committedEngine(replay.engine, manifest, read);
  const metrics = commitMetrics(engine, manifest, read);
  if (canonicalJson(metrics) !== canonicalJson(receipt.body.metrics)) throw new Error('Receipt differs from recomputed metrics');
  const report = engine.report();
  return {
    verification: 'event-chain-and-score-valid', assurance: 'self-attested',
    sourceCommit: receipt.body.targetCommit, eventLog: receipt.body.eventLog, metrics,
    files: report.files.map(f => {
      let offset = 0;
      const segments = engine.files.get(f.path)!.segments.map(s => {
        const segment = { offset, length: s.text.length, score: s.score, origin: s.origin };
        offset += s.text.length;
        return segment;
      });
      return { ...f, segments };
    })
  };
}
