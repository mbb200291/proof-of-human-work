/** PoHW portable self-attested receipt v1. No external npm runtime dependencies. */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const RECEIPT_VERSION = 'pohw-editing-receipt/v2';
const EXCLUDED = new Set(['.git', '.pohw', 'node_modules', 'dist', 'out', 'build', 'coverage', '.venv', 'venv']);
const EXTENSIONS = new Set(['.go', '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.kts', '.sh', '.sql', '.vue', '.svelte', '.html', '.css', '.json', '.yaml', '.yml', '.toml', '.md', '.xml', '.proto']);
const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/** Recursive key ordering prevents signatures depending on JSON field insertion order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function eligible(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/');
  const chunks = normalized.split('/');
  if (chunks.some(x => EXCLUDED.has(x)) || normalized.startsWith('/') || chunks.includes('..')) return false;
  return EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

export interface CodeManifest { algorithm: 'pohw-code-files-sha256-v1'; rootHash: string; files: Array<{ path: string; sha256: string }> }

/** Include committed/indexed and not-yet-added files; require identical code contents at CI checkout. */
export function codeManifest(root: string): CodeManifest {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, timeout: 15_000, maxBuffer: 12 * 1024 * 1024
  });
  const names = [...new Set(output.toString('utf8').split('\0').filter(Boolean))].filter(eligible).sort();
  if (names.length > 20000) throw new Error('PoHW file limit exceeded (20000)');
  const files: CodeManifest['files'] = [];
  for (const name of names) {
    const absolute = path.join(root, name);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile()) throw new Error(`PoHW excludes symlinks and non-regular source files: ${name}`);
    if (stat.size > 2 * 1024 * 1024) throw new Error(`PoHW source file too large: ${name}`);
    files.push({ path: name.replace(/\\/g, '/'), sha256: sha256(fs.readFileSync(absolute)) });
  }
  return { algorithm: 'pohw-code-files-sha256-v1', rootHash: sha256(canonicalJson(files)), files };
}


/** Read exactly the source files stored in a Git commit, never the working tree or index. */
export function codeManifestForCommit(root: string, commit: string): CodeManifest {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid Git commit SHA');
  const objectType = execFileSync('git', ['cat-file', '-t', commit], { cwd: root, encoding: 'utf8' }).trim();
  if (objectType !== 'commit') throw new Error('PoHW target must be a Git commit');
  const output = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', commit], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const files: CodeManifest['files'] = [];
  for (const entry of output.toString('utf8').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    if (tab < 0) throw new Error('Malformed Git tree');
    const [mode, type, object] = entry.slice(0, tab).split(' ');
    const file = entry.slice(tab + 1);
    if (!eligible(file)) continue;
    if (!['100644', '100755'].includes(mode) || type !== 'blob') throw new Error(`Unsupported Git source type: ${file}`);
    const contents = execFileSync('git', ['cat-file', 'blob', object], { cwd: root, maxBuffer: 2 * 1024 * 1024 + 1024 });
    if (contents.length > 2 * 1024 * 1024) throw new Error(`PoHW source file too large: ${file}`);
    files.push({ path: file, sha256: sha256(contents) });
  }
  if (files.length > 20000) throw new Error('PoHW file limit exceeded (20000)');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { algorithm: 'pohw-code-files-sha256-v1', rootHash: sha256(canonicalJson(files)), files };
}

/** Return UTF-8 commit content for safe, exact provenance comparison. */
export function gitCommitFile(root: string, commit: string, filename: string): string | null {
  try {
    const contents = execFileSync('git', ['show', `${commit}:${filename}`], { cwd: root, maxBuffer: 2 * 1024 * 1024 + 1024 });
    if (contents.includes(0) || !contents.equals(Buffer.from(contents.toString('utf8'), 'utf8'))) return null;
    return contents.toString('utf8');
  } catch { return null; }
}

export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return sha256(der);
}

export function createLocalKeys(): { privateKeyPem: string; publicKeyPem: string } {
  const keys = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  };
}

export interface ReceiptBody {
  schema: typeof RECEIPT_VERSION;
  claim: 'self-attested-editor-behavior';
  issuedAt: string;
  targetCommit: string;
  keyId: string;
  code: { rootHash: string; files: number; algorithm: CodeManifest['algorithm'] };
  metrics: { scorePercent: number | null; coveragePercent: number; units: number; monitoredUnits: number; algorithm: 'rule-based-v0.1' };
  session: { startedAt: string | null; endedAt: string | null; auditTip: string };
}
export interface SignedReceipt { body: ReceiptBody; signature: string }

export function issueReceipt(body: ReceiptBody, privateKeyPem: string): SignedReceipt {
  const signature = sign(null, Buffer.from(canonicalJson(body)), createPrivateKey(privateKeyPem)).toString('base64');
  return { body, signature };
}

function validPercent(x: unknown): boolean { return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100; }
export function verifySignedReceipt(receipt: SignedReceipt, publicKeyPem: string, manifest: CodeManifest): void {
  if (!receipt || !receipt.body || typeof receipt.signature !== 'string') throw new Error('Malformed PoHW receipt');
  const body = receipt.body;
  if (body.schema !== RECEIPT_VERSION || body.claim !== 'self-attested-editor-behavior') throw new Error('Unsupported PoHW receipt claim/schema');
  if (!/^[a-f0-9]{40}$/.test(body.targetCommit)) throw new Error('Invalid target commit in receipt');
  if (body.keyId !== keyFingerprint(publicKeyPem)) throw new Error('Receipt signer differs from registered public key');
  if (body.code.algorithm !== manifest.algorithm || body.code.rootHash !== manifest.rootHash || body.code.files !== manifest.files.length) {
    throw new Error('Code content does not match signed receipt (rerun PoHW Publish Signed Receipt)');
  }
  const m = body.metrics;
  if (!m || m.algorithm !== 'rule-based-v0.1' || !Number.isSafeInteger(m.units) || !Number.isSafeInteger(m.monitoredUnits) ||
      m.units < 0 || m.monitoredUnits < 0 || m.monitoredUnits > m.units ||
      !validPercent(m.coveragePercent) || (m.scorePercent !== null && !validPercent(m.scorePercent)) ||
      (m.monitoredUnits === 0 && m.scorePercent !== null) ||
      (m.monitoredUnits > 0 && m.scorePercent === null) ||
      Math.abs(m.coveragePercent - (m.units ? m.monitoredUnits / m.units * 100 : 0)) > 0.011) {
    throw new Error('Receipt metrics are inconsistent');
  }
  if (!/^[a-f0-9]{64}$/.test(body.session?.auditTip ?? '') || !Number.isFinite(Date.parse(body.issuedAt))) throw new Error('Invalid receipt metadata');
  let ok = false;
  try { ok = verify(null, Buffer.from(canonicalJson(body)), createPublicKey(publicKeyPem), Buffer.from(receipt.signature, 'base64')); } catch { /* reject */ }
  if (!ok) throw new Error('Receipt signature verification failed');
}

/** This is only ever published after the signed receipt was independently checked. */
export function verifiedBadgeSummary(receipt: SignedReceipt, sourceCommit: string): Record<string, unknown> {
  return {
    verification: 'signature-and-content-valid',
    assurance: 'self-attested',
    humanScore: receipt.body.metrics.scorePercent === null ? 'N/A' : receipt.body.metrics.scorePercent,
    monitoredCoverage: receipt.body.metrics.coveragePercent,
    sourceCommit,
    sourceCodeHash: receipt.body.code.rootHash,
    issuedAt: receipt.body.issuedAt
  };
}

/** Badge initialization may be run repeatedly without duplicating the README block. */
export function badgeMarkdown(owner: string, repo: string, defaultBranch: string): string {
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/pohw-badges/summary.json`;
  const dynamic = (field: string, label: string, color: string): string =>
    `https://img.shields.io/badge/dynamic/json?url=${encodeURIComponent(base)}&query=${encodeURIComponent('$.' + field)}&suffix=%25&label=${encodeURIComponent(label)}&color=${color}`;
  const report = `https://github.com/${owner}/${repo}/blob/pohw-badges/REPORT.md`;
  return [
    '<!-- pohw-badges:start -->',
    `[![PoHW Editing Score](${dynamic('humanScore', 'PoHW Editing Score', 'blue')})](${report})`,
    `[![PoHW Monitored](${dynamic('monitoredCoverage', 'PoHW Monitored', 'informational')})](${report})`,
    `[![PoHW Receipt Verification](https://github.com/${owner}/${repo}/actions/workflows/pohw-verify.yml/badge.svg?branch=${encodeURIComponent(defaultBranch)})](https://github.com/${owner}/${repo}/actions/workflows/pohw-verify.yml)`,
    '<!-- pohw-badges:end -->'
  ].join('\n');
}

export function updateBadgeReadme(readme: string, badges: string): string {
  const start = '<!-- pohw-badges:start -->', end = '<!-- pohw-badges:end -->';
  const a = readme.indexOf(start), b = readme.indexOf(end);
  if ((a >= 0) !== (b >= 0) || (a >= 0 && b < a)) throw new Error('Malformed PoHW README badge markers');
  if (a >= 0) return readme.slice(0, a) + badges + readme.slice(b + end.length);
  return `${badges}\n\n${readme}`;
}