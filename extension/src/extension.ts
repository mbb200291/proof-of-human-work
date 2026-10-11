import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256, EditingEngine, Edit, textOf } from './core';
import { badgeMarkdown, codeManifestForCommit, gitCommitFile, createLocalKeys, issueReceipt, keyFingerprint, ReceiptBody, updateBadgeReadme, verifySignedReceipt } from './proof';
import { gitHead, writeEvidenceCommit, pushEvidence } from './evidence-git';
import { EventJournal, replayJournal } from './event-log';
import { commitMetrics } from './replay-proof';

const fmt = (v: number | null) => v === null ? 'N/A' : `${(v * 100).toFixed(1)}%`;
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const CONFIG_SECTION = 'pohw';
const extensionFiles = new Set(['.go', '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.kts', '.sh', '.sql', '.vue', '.svelte', '.html', '.css', '.json', '.yaml', '.yml', '.toml', '.md', '.xml', '.proto']);

class Monitor implements vscode.Disposable {
  private engine = new EditingEngine();
  private root?: vscode.WorkspaceFolder;
  private active = false;
  private starting = false;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private baselineHead: string | null = null;
  private journal?: EventJournal;
  private evidenceError: string | null = null;
  private disposed = false;
  private get tip(): string { return this.journal?.tip ?? sha256('pohw:v0'); }
  private get recentEvents() {
    return (this.journal?.recent ?? []).map(e => ({ time: e.timestamp, path: e.file ?? '', kind: e.kind,
      added: e.edit?.inserted.length ?? 0, removed: e.edit?.deleted ?? 0 }));
  }
  private watchers: vscode.Disposable[] = [];
  private bar: vscode.StatusBarItem;
  private reportPanel?: vscode.WebviewPanel;
  private evidenceTimer?: ReturnType<typeof setInterval>;
  private lastObservedHead: string | null = null;
  private lastSyncedHead: string | null = null;
  private syncing = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.bar.command = 'pohw.report';
    this.bar.tooltip = 'PoHW: click to show coding provenance report';
    this.bar.show();
    this.updateBar();
  }
  private path(uri: vscode.Uri): string | null {
    if (!this.root || uri.scheme !== 'file') return null;
    const base = this.root.uri.fsPath.replace(/[\\/]+$/, '') + '/';
    const full = uri.fsPath.replace(/\\/g, '/');
    const root = base.replace(/\\/g, '/');
    return full.startsWith(root) ? full.slice(root.length) : null;
  }
  private eligible(path: string): boolean {
    return extensionFiles.has('.' + (path.split('.').pop() ?? '').toLowerCase());
  }
  private async storeFile(): Promise<vscode.Uri> {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    const identifier = sha256(this.root!.uri.toString()).slice(0, 24);
    return vscode.Uri.joinPath(this.context.globalStorageUri, `${identifier}.json`);
  }
  private async write(): Promise<void> { this.journal?.flush(); }
  private failEvidence(err: unknown): void {
    this.evidenceError = (err as Error).message;
    this.active = false;
    this.updateBar();
    void vscode.window.showErrorMessage(`PoHW recording and receipt issuance blocked: ${this.evidenceError}`);
  }
  private change(operation: (journal: EventJournal) => void): void {
    if (this.disposed || this.evidenceError || !this.journal) return;
    try { operation(this.journal); this.updateBar(); }
    catch (err) { this.failEvidence(err); }
  }
  private ensure(file: string, text = ''): void { this.change(j => j.ensure(file, text)); }
  private reconcile(file: string, text: string): void { this.change(j => j.reconcile(file, text)); }
  private async load(): Promise<void> {
    if (!this.root) return;
    try {
      const identifier = sha256(this.root.uri.toString()).slice(0, 24);
      const filename = path.join(this.context.globalStorageUri.fsPath, `${identifier}.events.jsonl`);
      this.journal = await EventJournal.open(filename);
      this.engine = this.journal.engine;
      if (this.journal.seq === 0) {
        // Legacy files remain untouched; their cached scores lack replayable evidence.
        try {
          await vscode.workspace.fs.readFile(await this.storeFile());
          void vscode.window.showWarningMessage('PoHW upgraded to complete event logs. Legacy data is retained; prior scores restart as unverified baselines.');
        } catch (err) {
          if (!(err instanceof vscode.FileSystemError && err.code === 'FileNotFound') &&
              (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      }
      if (this.journal.active) this.journal.session(false);
      this.startedAt = this.journal.startedAt;
      this.stoppedAt = this.journal.stoppedAt;
      this.active = false;
    } catch (err) { this.failEvidence(err); }
  }
  private updateBar(): void {
    const report = this.engine.report();
    if (this.evidenceError) { this.bar.text = '$(error) PoHW Evidence Error'; return; }
    this.bar.text = this.active
      ? `$(record) PoHW ${fmt(report.score)} · ${fmt(report.coverage)} covered`
      : `$(circle-slash) PoHW Paused`;
  }
  private recordEdit(file: string, edit: Edit, external: boolean): void {
    this.change(j => j.apply(file, edit, Date.now(), external));
  }
  private async readSource(uri: vscode.Uri): Promise<string | null> {
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      const max = vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('maxFileBytes', 524288);
      if (data.byteLength > max || data.includes(0)) return null;
      return Buffer.from(data).toString('utf8');
    } catch { return null; }
  }
  private async diskChange(uri: vscode.Uri, deleted = false): Promise<void> {
    if (!this.active) return;
    const path = this.path(uri);
    if (!path || !this.eligible(path)) return;
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (open?.isDirty) return; // Never judge an unsaved buffer using disk state.
    const content = deleted ? '' : await this.readSource(uri);
    if (content === null) return;
    if (!this.active || this.disposed) return;
    this.reconcile(path, content);
  }
  private async initializeFile(uri: vscode.Uri): Promise<void> {
    if (!this.root) return;
    const path = this.path(uri);
    if (!path || !this.eligible(path) || this.engine.files.has(path)) return;
    const text = await this.readSource(uri);
    if (text !== null && this.active && !this.disposed) this.ensure(path, text);
  }
  private async refreshBaseline(): Promise<void> {
    if (!this.root) return;
    const conf = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const include = new vscode.RelativePattern(this.root, conf.get<string>('include', '**/*'));
    const exclude = conf.get<string>('exclude', '**/{.git,node_modules,dist,out,build,coverage,.venv,venv,.pohw}/**');
    const found = await vscode.workspace.findFiles(include, exclude, conf.get<number>('maxFiles', 2000));
    for (const uri of found) {
      const path = this.path(uri);
      if (!path || !this.eligible(path)) continue;
      const text = await this.readSource(uri);
      if (text === null) continue;
      const existing = this.engine.files.get(path);
      if (existing && textOf(existing) === text) continue; // Preserve prior provenance.
      if (!existing) this.ensure(path, text);
      else this.reconcile(path, text); // Any change while monitoring was off is unverified.
    }
    for (const path of [...this.engine.files.keys()]) {
      if (!found.some(uri => this.path(uri) === path)) {
        const file = this.engine.files.get(path)!;
        if (textOf(file)) this.reconcile(path, '');
      }
    }
  }
  private async getGitHead(): Promise<string | null> {
    if (!this.root) return null;
    try {
      const { execFile } = await import('node:child_process');
      return await new Promise(resolve => execFile('git', ['rev-parse', 'HEAD'], { cwd: this.root!.uri.fsPath, timeout: 3000 }, (err, out) => resolve(err ? null : out.trim())));
    } catch { return null; }
  }
  async prepare(): Promise<void> {
    if (vscode.workspace.workspaceFolders?.length !== 1) { this.updateBar(); return; }
    this.root = vscode.workspace.workspaceFolders[0];
    await this.load();
    if (this.evidenceError) return;
    await this.refreshBaseline(); // Reconcile any changes made while the extension was not active.
    this.updateBar();
    const pattern = new vscode.RelativePattern(this.root, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watchers.push(watcher,
      watcher.onDidCreate(uri => { void this.diskChange(uri); }),
      watcher.onDidChange(uri => { setTimeout(() => { void this.diskChange(uri); }, 300); }),
      watcher.onDidDelete(uri => { void this.diskChange(uri, true); }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!this.active || !event.contentChanges.length) return;
        const path = this.path(event.document.uri);
        if (!path || !this.eligible(path)) return;
        const tracked = this.engine.files.get(path);
        if (!tracked) {
          // Newly created empty files can be tracked from their first insertion.
          const single = event.contentChanges.length === 1 ? event.contentChanges[0] : null;
          if (single && single.rangeOffset === 0 && single.rangeLength === 0 &&
              single.text === event.document.getText() && event.document.isDirty) {
            this.ensure(path, '');
            this.recordEdit(path, { start: 0, deleteCount: 0, insert: single.text }, false);
          } else {
            // Pre-event content is unknown: classify as unverified.
            this.ensure(path, event.document.getText());
          }
          return;
        }
        // Changes refer to the pre-event document. Apply from the end to preserve offsets.
        const external = !event.document.isDirty;
        const changes = [...event.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
        try {
          for (const change of changes) {
            this.recordEdit(path, { start: change.rangeOffset, deleteCount: change.rangeLength, insert: change.text }, external);
          }
          if (textOf(tracked) !== event.document.getText()) {
            this.reconcile(path, event.document.getText());
          }
        } catch (err) {
          console.warn('PoHW out-of-sync editor event', err);
          this.reconcile(path, event.document.getText());
        }
      }),
      vscode.workspace.onDidOpenTextDocument(d => { if (this.active) void this.initializeFile(d.uri); }),
      vscode.workspace.onDidSaveTextDocument(d => {
        if (!this.active) return;
        const path = this.path(d.uri);
        if (!path || !this.eligible(path)) return;
        this.ensure(path);
        this.reconcile(path, d.getText());
        this.change(j => j.save(path));
      })
    );
    // Poll HEAD rather than watching .git/HEAD: regular branch commits update refs/heads/*, not HEAD.
    this.lastObservedHead = await this.getGitHead();
    this.evidenceTimer = setInterval(() => { void this.pollCommitEvidence(); }, 5000);
    this.evidenceTimer.unref(); // Do not keep a Node process alive solely for polling.
  }
  private async pollCommitEvidence(): Promise<void> {
    if (!this.root || this.syncing || this.evidenceError || this.disposed) return;
    try { await fs.access(this.repoPath('.pohw/public-key.pem')); }
    catch { return; }
    const head = await this.getGitHead();
    if (!head || head === this.lastSyncedHead) return;
    if (head === this.lastObservedHead) return;
    const previous = this.lastObservedHead;
    this.lastObservedHead = head;
    // Switch/checkout may change HEAD without new authored work; avoid emitting evidence.
    let action = '';
    try { action = execFileSync('git', ['reflog', '-1', '--format=%gs'], { cwd: this.root.uri.fsPath, encoding: 'utf8' }).trim(); }
    catch { /* no reflog; user can manually sync */ }
    if (!/^(commit( \([^)]*\))?|merge|rebase \([^)]*\)|cherry-pick):/.test(action)) return;
    let commits = [head];
    if (previous && /^[a-f0-9]{40}$/.test(previous)) {
      try {
        const list = execFileSync('git', ['rev-list', '--reverse', `${previous}..${head}`], {
          cwd: this.root.uri.fsPath, encoding: 'utf8', timeout: 5000
        }).trim().split('\n').filter(Boolean);
        if (list.length > 0 && list.length <= 100) commits = list;
      } catch { /* changed branches or history: use latest commit */ }
    }
    for (const commit of commits) await this.syncEvidence(false, commit);

  }
  async start(): Promise<void> {
    if (this.evidenceError || !this.journal || this.disposed) { void vscode.window.showErrorMessage('PoHW event log unavailable; monitoring is blocked.'); return; }
    if (this.active || this.starting) { void vscode.window.showInformationMessage('PoHW monitoring is already active or starting.'); return; }
    if (!this.root) { void vscode.window.showWarningMessage('Open exactly one folder before starting PoHW.'); return; }
    this.starting = true;
    try {
      const dirty = vscode.workspace.textDocuments.filter(d => d.isDirty && this.path(d.uri));
      if (dirty.length) { void vscode.window.showWarningMessage('Save all dirty files before starting PoHW monitoring.'); return; }
      await this.refreshBaseline();
      if (this.evidenceError || this.disposed) return;
      this.baselineHead = await this.getGitHead();
      if (this.evidenceError || this.disposed) return;
      this.change(j => j.session(true));
      if (this.evidenceError) return;
      this.startedAt = this.journal.startedAt; this.stoppedAt = null;
      this.active = true; this.updateBar();
      void vscode.window.showInformationMessage('PoHW monitoring started. Existing code is unverified unless previously tracked.');
    } catch (err) { this.failEvidence(err); }
    finally { this.starting = false; }
  }
  async stop(): Promise<void> {
    if (!this.active) { void vscode.window.showInformationMessage('PoHW monitoring is not active.'); return; }
    this.change(j => j.session(false));
    this.active = false; this.stoppedAt = this.journal?.stoppedAt ?? null;
    try { await this.write(); } catch (err) { this.failEvidence(err); return; }
    this.updateBar();
    void vscode.window.showInformationMessage('PoHW monitoring stopped; provenance is saved locally.');
    await this.report();
    // Receipt is bound to a Git commit, not a dirty working tree. A later user commit triggers sync.
  }

  private repositoryIdentity(): { owner: string; repo: string; branch: string } {
    if (!this.root) throw new Error('Open one workspace folder first.');
    const cwd = this.root.uri.fsPath;
    const actualRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    if (path.resolve(actualRoot) !== path.resolve(cwd)) throw new Error('Open the Git repository root, not a subfolder.');
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote);
    if (!match) throw new Error('PoHW Badge currently supports GitHub origin URLs only.');
    let branch = 'main';
    try {
      const remoteHead = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      branch = remoteHead.replace(/^origin\//, '');
    } catch { /* Ask the user in the command when remote HEAD is unavailable. */ }
    return { owner: match[1], repo: match[2], branch };
  }
  private async localKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    const secret = path.join(this.context.globalStorageUri.fsPath, `pohw-${sha256(this.root!.uri.toString()).slice(0, 24)}-ed25519-private.pem`);
    let privateKeyPem: string;
    try { privateKeyPem = await fs.readFile(secret, 'utf8'); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const pair = createLocalKeys();
      try { await fs.writeFile(secret, pair.privateKeyPem, { mode: 0o600, flag: 'wx' }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      privateKeyPem = await fs.readFile(secret, 'utf8');
    }
    const { createPrivateKey, createPublicKey } = await import('node:crypto');
    const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString();
    return { privateKeyPem, publicKeyPem };
  }
  private repoPath(name: string): string { return path.join(this.root!.uri.fsPath, name); }
  private async registeredKey(local: string): Promise<void> {
    const pinned = await fs.readFile(this.repoPath('.pohw/public-key.pem'), 'utf8');
    if (keyFingerprint(pinned) !== keyFingerprint(local)) {
      throw new Error('This repository is registered to a different key. Use the original VS Code profile, or explicitly rotate the repository key with a documented trust reset.');
    }
  }
  private async writeGeneratedFile(file: string, content: Buffer | string): Promise<void> {
    const desired = Buffer.isBuffer(content) ? content : Buffer.from(content);
    try {
      const existing = await fs.readFile(file);
      if (existing.equals(desired)) return;
      const answer = await vscode.window.showWarningMessage(
        `PoHW generated file ${path.relative(this.root!.uri.fsPath, file)} differs. Update it to enable the new commit-evidence protocol?`,
        { modal: true }, 'Update PoHW File'
      );
      if (answer !== 'Update PoHW File') throw new Error(`Update cancelled for ${file}`);
      await fs.writeFile(file, desired);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.writeFile(file, desired, { flag: 'wx' });
    }
  }
  async enableBadge(): Promise<void> {
    try {
      const project = this.repositoryIdentity();
      const branch = await vscode.window.showInputBox({ prompt: 'GitHub default branch for the verification badge', value: project.branch, ignoreFocusOut: true });
      if (!branch) return;
      if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) throw new Error('Invalid Git branch name.');
      const keys = await this.localKeyPair();
      await fs.mkdir(this.repoPath('.pohw'), { recursive: true });
      try { await this.registeredKey(keys.publicKeyPem); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        await fs.writeFile(this.repoPath('.pohw/public-key.pem'), keys.publicKeyPem, { flag: 'wx' });
      }
      const proof = await fs.readFile(path.join(this.context.extensionPath, 'out/proof.js'));
      const cli = await fs.readFile(path.join(this.context.extensionPath, 'templates/verify-receipt.cjs'));
      const { createHash } = await import('node:crypto');
      const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
      for (const [name, contents] of [['proof.js', proof], ['verify.cjs', cli]] as const) {
        await this.writeGeneratedFile(this.repoPath('.pohw/' + name), contents);
      }
      const destination = this.repoPath('.github/workflows/pohw-verify.yml');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const template = (await fs.readFile(path.join(this.context.extensionPath, 'templates/pohw-verify.yml'), 'utf8'))
        .replace('@@HASH_PROOF@@', hash(proof)).replace('@@HASH_CLI@@', hash(cli))
        .replace('@@DEFAULT_BRANCH@@', JSON.stringify(branch));
      await this.writeGeneratedFile(destination, template);
      let readme = '';
      try { readme = await fs.readFile(this.repoPath('README.md'), 'utf8'); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
      await fs.writeFile(this.repoPath('README.md'), updateBadgeReadme(readme, badgeMarkdown(project.owner, project.repo, branch)));
      await this.refreshBaseline();
      this.lastObservedHead = await this.getGitHead();
      void vscode.window.showInformationMessage('PoHW Badge enabled. Commit the one-time setup files normally; future commits generate separate signed evidence automatically.');
    } catch (err) { void vscode.window.showErrorMessage(`PoHW Badge initialization failed: ${(err as Error).message}`); }
  }
  /** Sync an existing Git commit without modifying user HEAD, index, or worktree. */
  async syncEvidence(interactive = true, commitSha?: string): Promise<void> {
    if (!this.root || this.syncing) return;
    this.syncing = true;
    try {
      if (this.evidenceError || !this.journal || this.disposed) throw new Error('Event log unavailable; receipt issuance blocked');
      this.repositoryIdentity();
      const targetCommit = commitSha ?? gitHead(this.root.uri.fsPath);
      const { privateKeyPem, publicKeyPem } = await this.localKeyPair();
      await this.registeredKey(publicKeyPem);
      const manifest = codeManifestForCommit(this.root.uri.fsPath, targetCommit);
      this.journal.flush();
      const commitment = this.journal.commitment();
      const replay = await replayJournal(this.journal.filename, commitment);
      const metrics = commitMetrics(replay.engine, manifest, file => gitCommitFile(this.root!.uri.fsPath, targetCommit, file));
      const body: ReceiptBody = {
        schema: 'pohw-editing-receipt/v2', claim: 'self-attested-editor-behavior', targetCommit,
        issuedAt: new Date().toISOString(), keyId: keyFingerprint(publicKeyPem),
        code: { rootHash: manifest.rootHash, files: manifest.files.length, algorithm: manifest.algorithm },
        metrics,
        session: { startedAt: replay.startedAt, endedAt: replay.stoppedAt, auditTip: replay.tip },
        eventLog: commitment
      };
      const receipt = issueReceipt(body, privateKeyPem);
      verifySignedReceipt(receipt, publicKeyPem, manifest);
      const result = writeEvidenceCommit(this.root.uri.fsPath, receipt, publicKeyPem);
      // Keep proof locally even if push is not currently possible. The next sync retries.
      if (vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('evidenceAutoPush', true)) {
        pushEvidence(this.root.uri.fsPath);
      } else if (interactive) {
        void vscode.window.showInformationMessage('PoHW evidence committed locally. Auto push is disabled; sync the evidence ref when ready.');
      }
      this.lastSyncedHead = targetCommit;
      if (interactive) void vscode.window.showInformationMessage(`PoHW evidence ${result.updated ? 'created' : 'already exists'} for ${targetCommit.slice(0, 12)}. Your Git staging area was not modified.`);
    } catch (error) {
      // Retry is possible by command without editing the existing source commit.
      void vscode.window.showErrorMessage(`PoHW evidence sync failed: ${(error as Error).message}`);
    } finally { this.syncing = false; }
  }
  private renderReport(): string {
    const r = this.engine.report();
    const e = escapeHtml;
    const rows = r.files.filter(f => f.units > 0).map(f => `<tr>
      <td><code>${e(f.path)}</code></td>
      <td>${e(fmt(f.score))}</td><td>${e(fmt(f.coverage))}</td>
      <td>${f.byOrigin.incremental}</td><td>${f.byOrigin.bulk}</td>
      <td>${f.byOrigin.external}</td><td>${f.byOrigin.baseline}</td>
    </tr>`).join('\n');
    const events = this.recentEvents.slice(-30).reverse().map(event => `<tr>
      <td>${e(event.time)}</td><td><code>${e(event.path)}</code></td>
      <td>${e(event.kind)}</td><td>+${event.added} / -${event.removed}</td>
    </tr>`).join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>PoHW Coding Provenance Report</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 18px 24px; line-height: 1.55; }
  h1 { font-size: 1.5rem; margin: 0 0 8px; } h2 { margin-top: 32px; font-size: 1.1rem; }
  .subtle { color: var(--vscode-descriptionForeground); }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit,minmax(190px,1fr)); gap: 12px; margin: 20px 0; }
  .metric { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px; }
  .metric strong { font-size: 1.65rem; display: block; } .metric span { font-size: .84rem; color: var(--vscode-descriptionForeground); }
  .meta { display: grid; grid-template-columns: minmax(160px,max-content) minmax(0,1fr); gap: 6px 18px; }
  .meta dt { color: var(--vscode-descriptionForeground); } .meta dd { margin: 0; overflow-wrap: anywhere; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .91rem; }
  th,td { padding: 7px 9px; border-bottom: 1px solid var(--vscode-panel-border); text-align: left; white-space: nowrap; }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; }
  code { font-family: var(--vscode-editor-font-family); } .notice { border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 14px; margin-top: 22px; }
</style>
</head>
<body>
<h1>PoHW Coding Provenance Report</h1>
<div class="subtle">Read-only report · Status: ${this.active ? 'Recording' : 'Paused'}</div>
<div class="metrics">
  <div class="metric"><strong>${e(fmt(r.score))}</strong><span>Human editing evidence score (monitored code only)</span></div>
  <div class="metric"><strong>${e(fmt(r.coverage))}</strong><span>Monitored coverage</span></div>
  <div class="metric"><strong>${r.units - r.verifiedUnits} / ${r.units}</strong><span>Unverified code (non-whitespace characters)</span></div>
</div>
<dl class="meta">
  <dt>Started</dt><dd>${e(this.startedAt ?? 'N/A')}</dd>
  <dt>Stopped</dt><dd>${e(this.stoppedAt ?? 'N/A')}</dd>
  <dt>Baseline Git HEAD</dt><dd><code>${e(this.baselineHead ?? 'N/A')}</code></dd>
  <dt>Local event log</dt><dd><code>${e(this.journal?.filename ?? 'Unavailable')}</code></dd>
  <dt>Evidence status</dt><dd>${e(this.evidenceError ?? 'Local replay available; public receipt scores are not recomputed without this log.')}</dd>
  <dt>Audit chain tip</dt><dd><code>${e(this.tip)}</code></dd>
</dl>
<p class="notice">This is a rule-based editing-pattern score, <strong>not</strong> a calibrated probability of human authorship. No statistically meaningful 95% confidence interval is available without labeled validation data. Automated editor changes and off-device AI assistance may be indistinguishable from human editing.</p>
<h2>File provenance</h2>
<div class="table-wrap"><table><thead><tr><th>File</th><th>Score</th><th>Coverage</th><th>Incremental</th><th>Bulk</th><th>External</th><th>Baseline</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Recent events (last 30)</h2>
<div class="table-wrap"><table><thead><tr><th>Time</th><th>File</th><th>Event</th><th>Characters</th></tr></thead><tbody>${events}</tbody></table></div>
</body></html>`;
  }
  async report(): Promise<void> {
    if (!this.root) { void vscode.window.showWarningMessage('Open one workspace folder to use PoHW.'); return; }
    if (!this.reportPanel) {
      const panel = vscode.window.createWebviewPanel(
        'pohwProvenanceReport', 'PoHW Coding Provenance Report',
        vscode.ViewColumn.Active, { enableScripts: false, retainContextWhenHidden: false }
      );
      this.reportPanel = panel;
      // The disposed panel releases its own listener; do not accumulate listeners across report openings.
      panel.onDidDispose(() => { if (this.reportPanel === panel) this.reportPanel = undefined; });
    }
    this.reportPanel.webview.html = this.renderReport();
    this.reportPanel.reveal();
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.evidenceTimer) clearInterval(this.evidenceTimer);
    try {
      if (this.active && !this.evidenceError) this.journal?.session(false);
      if (!this.evidenceError) this.journal?.flush();
    } catch (err) { console.error('PoHW event log shutdown failed', err); }
    finally { this.journal?.close(); this.disposed = true; this.active = false; }
    this.reportPanel?.dispose();
    for (const d of this.watchers) d.dispose();
    this.bar.dispose();
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const monitor = new Monitor(context);
  context.subscriptions.push(monitor,
    vscode.commands.registerCommand('pohw.start', () => monitor.start()),
    vscode.commands.registerCommand('pohw.stop', () => monitor.stop()),
    vscode.commands.registerCommand('pohw.report', () => monitor.report()),
    vscode.commands.registerCommand('pohw.enableBadge', () => monitor.enableBadge()),
    vscode.commands.registerCommand('pohw.publishReceipt', () => monitor.syncEvidence()),
    vscode.commands.registerCommand('pohw.syncEvidence', () => monitor.syncEvidence()));
  await monitor.prepare();
}
export function deactivate(): void { /* disposed by VS Code */ }