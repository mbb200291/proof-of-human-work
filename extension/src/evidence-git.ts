/** Git plumbing for isolated PoHW evidence commits. Never touches HEAD or user's index. */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SignedReceipt, codeManifestForCommit, verifySignedReceipt } from './proof';

const GIT_TIMEOUT = 20_000;
function git(root: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: options.timeout ?? GIT_TIMEOUT,
    input: options.input, env: options.env, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
export const EVIDENCE_REF = 'refs/pohw/evidence';
export const REMOTE_EVIDENCE_REF = 'refs/heads/pohw-evidence';
export function gitHead(root: string): string { return git(root, ['rev-parse', 'HEAD']); }
export function evidencePath(commit: string): string {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid evidence target commit');
  return `receipts/${commit}.json`;
}
export function writeEvidenceCommit(root: string, receipt: SignedReceipt, publicKeyPem: string): { evidenceCommit: string; updated: boolean } {
  const target = receipt.body.targetCommit;
  verifySignedReceipt(receipt, publicKeyPem, codeManifestForCommit(root, target));
  const filename = evidencePath(target);
  let base: string | undefined;
  let local: string | undefined;
  try { local = git(root, ['rev-parse', EVIDENCE_REF]); base = local; } catch { /* first evidence commit */ }
  // Fetch remote before extending it. This avoids a force push and preserves receipts from other machines.
  try {
    git(root, ['fetch', '--no-tags', 'origin', REMOTE_EVIDENCE_REF], { timeout: 15000 });
    const remote = git(root, ['rev-parse', 'FETCH_HEAD']);
    if (!base) base = remote;
    else if (base !== remote) {
      const common = git(root, ['merge-base', base, remote]);
      if (common !== base) throw new Error('Evidence branch diverged; manual recovery required');
      base = remote;
    }
  } catch (error) {
    // A missing remote branch is valid. Any other fetch failure is reported when we attempt to push.
    if (base && (error as Error).message.includes('Evidence branch diverged')) throw error;
  }
  if (base) {
    let exists = false;
    try { git(root, ['cat-file', '-e', `${base}:${filename}`]); exists = true; }
    catch { /* previously unseen target */ }
    if (exists) {
      const prior = git(root, ['show', `${base}:${filename}`]);
      const priorReceipt = JSON.parse(prior) as SignedReceipt;
      verifySignedReceipt(priorReceipt, publicKeyPem, codeManifestForCommit(root, target));
      if (local !== base) git(root, ['update-ref', EVIDENCE_REF, base, ...(local ? [local] : [])]);
      return { evidenceCommit: base, updated: false };
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-git-index-'));
  const index = path.join(dir, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    if (base) git(root, ['read-tree', base], { env });
    else git(root, ['read-tree', '--empty'], { env });
    const sha = git(root, ['hash-object', '-w', '--stdin'], { input: JSON.stringify(receipt, null, 2) + '\n' });
    git(root, ['update-index', '--add', '--cacheinfo', `100644,${sha},${filename}`], { env });
    const tree = git(root, ['write-tree'], { env });
    const args = ['-c', 'user.name=PoHW Evidence', '-c', 'user.email=pohw@localhost', 'commit-tree', tree];
    if (base) args.push('-p', base);
    args.push('-m', `pohw: evidence for ${target}`);
    const commit = git(root, args);
    git(root, ['update-ref', EVIDENCE_REF, commit, ...(local ? [local] : [])]);
    return { evidenceCommit: commit, updated: true };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
export function pushEvidence(root: string): void {
  git(root, ['push', 'origin', `${EVIDENCE_REF}:${REMOTE_EVIDENCE_REF}`], { timeout: 30000 });
}