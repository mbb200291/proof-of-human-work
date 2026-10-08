import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256, EditingEngine, Edit, Origin, StoredFile, textOf } from './core';
import { badgeMarkdown, codeManifest, createLocalKeys, issueReceipt, keyFingerprint, ReceiptBody, updateBadgeReadme, verifySignedReceipt } from './proof';

interface AuditEvent { seq: number; time: string; path: string; kind: string; before: string; after: string; added: number; removed: number; score: number | null; hash: string }
interface DiskState {
  version: 1;
  root: string;
  startedAt: string | null;
  stoppedAt: string | null;
  baselineHead: string | null;
  tip: string;
  seq: number;
  files: StoredFile[];
  recentEvents: AuditEvent[];
}

const fmt = (v: number | null) => v === null ? 'N/A' : `${(v * 100).toFixed(1)}%`;
const CONFIG_SECTION = 'pohw';
const extensionFiles = new Set(['.go', '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.kts', '.sh', '.sql', '.vue', '.svelte', '.html', '.css', '.json', '.yaml', '.yml', '.toml', '.md', '.xml', '.proto']);

class Monitor implements vscode.Disposable {
  private engine = new EditingEngine();
  private root?: vscode.WorkspaceFolder;
  private active = false;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private baselineHead: string | null = null;
  private tip = sha256('pohw:v0');
  private seq = 0;
  private recentEvents: AuditEvent[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private watchers: vscode.Disposable[] = [];
  private bar: vscode.StatusBarItem;

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
  private async write(): Promise<void> {
    if (!this.root) return;
    const state: DiskState = {
      version: 1, root: this.root.uri.toString(), startedAt: this.startedAt,
      stoppedAt: this.stoppedAt, baselineHead: this.baselineHead,
      tip: this.tip, seq: this.seq, files: [...this.engine.files.values()],
      recentEvents: this.recentEvents
    };
    await vscode.workspace.fs.writeFile(await this.storeFile(), Buffer.from(JSON.stringify(state)));
  }
  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.write().then(() => {}, err => console.error('PoHW persistence failed', err)); }, 1000);
  }
  private async load(): Promise<void> {
    if (!this.root) return;
    try {
      const raw = await vscode.workspace.fs.readFile(await this.storeFile());
      const state = JSON.parse(Buffer.from(raw).toString('utf8')) as DiskState;
      if (state.version !== 1 || state.root !== this.root.uri.toString()) return;
      this.engine = new EditingEngine(state.files);
      this.tip = state.tip;
      this.seq = state.seq;
      this.recentEvents = state.recentEvents ?? [];
      this.startedAt = state.startedAt;
      this.stoppedAt = state.stoppedAt ?? new Date().toISOString();
      // A restarted extension never resumes trusted recording automatically.
      this.active = false;
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') return;
      console.warn('PoHW: cannot restore stored state', err);
    }
  }
  private updateBar(): void {
    const report = this.engine.report();
    this.bar.text = this.active
      ? `$(record) PoHW ${fmt(report.score)} · ${fmt(report.coverage)} covered`
      : `$(circle-slash) PoHW Paused`;
  }
  private audit(path: string, kind: string, before: string, after: string, added: number, removed: number, score: number | null): void {
    const time = new Date().toISOString();
    const value = { seq: ++this.seq, time, path, kind, before, after, added, removed, score };
    this.tip = sha256(this.tip + JSON.stringify(value));
    this.recentEvents.push({ ...value, hash: this.tip });
    if (this.recentEvents.length > 1000) this.recentEvents.shift();
    this.updateBar();
    this.scheduleWrite();
  }
  private recordEdit(path: string, e: Edit, external: boolean): void {
    const f = this.engine.ensure(path);
    const before = f.hash;
    const signal = this.engine.apply(path, e, Date.now(), external);
    this.audit(path, signal.kind, before, f.hash, signal.added, signal.removed, signal.score);
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
    const f = this.engine.ensure(path);
    const before = f.hash;
    if (this.engine.reconcile(path, content)) {
      this.audit(path, 'external/unattributed', before, f.hash, content.length, 0, null);
    }
  }
  private async initializeFile(uri: vscode.Uri): Promise<void> {
    if (!this.root) return;
    const path = this.path(uri);
    if (!path || !this.eligible(path) || this.engine.files.has(path)) return;
    const text = await this.readSource(uri);
    if (text !== null) this.engine.ensure(path, text);
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
      if (!existing) this.engine.ensure(path, text);
      else this.engine.reconcile(path, text); // Any change while monitoring was off is unverified.
    }
    for (const path of [...this.engine.files.keys()]) {
      if (!found.some(uri => this.path(uri) === path)) {
        const file = this.engine.files.get(path)!;
        if (textOf(file)) this.engine.reconcile(path, '');
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
            this.engine.ensure(path, '');
            this.recordEdit(path, { start: 0, deleteCount: 0, insert: single.text }, false);
          } else {
            // Pre-event content is unknown: classify as unverified.
            this.engine.ensure(path, event.document.getText());
            this.audit(path, 'unattributed-new-document', '', sha256(event.document.getText()), 0, 0, null);
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
            const before = tracked.hash;
            this.engine.reconcile(path, event.document.getText());
            this.audit(path, 'unattributed-reconcile', before, tracked.hash, 0, 0, null);
          }
        } catch (err) {
          console.warn('PoHW out-of-sync editor event', err);
          const before = tracked.hash;
          this.engine.reconcile(path, event.document.getText());
          this.audit(path, 'unattributed-reconcile', before, tracked.hash, 0, 0, null);
        }
      }),
      vscode.workspace.onDidOpenTextDocument(d => { if (this.active) void this.initializeFile(d.uri); }),
      vscode.workspace.onDidSaveTextDocument(d => {
        if (!this.active) return;
        const path = this.path(d.uri);
        if (!path || !this.eligible(path)) return;
        const f = this.engine.ensure(path);
        if (textOf(f) !== d.getText()) {
          const before = f.hash;
          this.engine.reconcile(path, d.getText());
          this.audit(path, 'unattributed-save', before, f.hash, 0, 0, null);
        }
        f.saves++;
        this.audit(path, 'save', f.hash, f.hash, 0, 0, null);
      })
    );
  }
  async start(): Promise<void> {
    if (this.active) { void vscode.window.showInformationMessage('PoHW monitoring is already active.'); return; }
    if (!this.root) { void vscode.window.showWarningMessage('Open exactly one folder before starting PoHW.'); return; }
    const dirty = vscode.workspace.textDocuments.filter(d => d.isDirty && this.path(d.uri));
    if (dirty.length) { void vscode.window.showWarningMessage('Save all dirty files before starting PoHW monitoring.'); return; }
    await this.refreshBaseline();
    this.startedAt = new Date().toISOString(); this.stoppedAt = null;
    this.baselineHead = await this.getGitHead();
    this.active = true;
    this.audit('', 'session-start', '', '', 0, 0, null);
    void vscode.window.showInformationMessage('PoHW monitoring started. Existing code is unverified unless previously tracked.');
  }
  async stop(): Promise<void> {
    if (!this.active) { void vscode.window.showInformationMessage('PoHW monitoring is not active.'); return; }
    this.audit('', 'session-stop', '', '', 0, 0, null);
    this.active = false; this.stoppedAt = new Date().toISOString();
    if (this.timer) clearTimeout(this.timer);
    await this.write(); this.updateBar();
    void vscode.window.showInformationMessage('PoHW monitoring stopped; provenance is saved locally.');
    await this.report();
    try {
      // Badge-enabled projects publish the signed receipt on normal Stop.
      await fs.access(this.repoPath('.pohw/public-key.pem'));
      await this.publish();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        void vscode.window.showErrorMessage(`PoHW automatic receipt publication failed: ${(err as Error).message}`);
      }
    }
  }
  private repositoryIdentity(): { owner: string; repo: string; branch: string } {
    if (!this.root) throw new Error('Open one workspace folder first.');
    const cwd = this.root.uri.fsPath;
    const actualRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    if (path.resolve(actualRoot) !== path.resolve(cwd)) throw new Error('Open the Git repository root, not a subfolder.');
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
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
        const outputFile = this.repoPath('.pohw/' + name);
        try {
          const existing = await fs.readFile(outputFile);
          if (!existing.equals(contents)) throw new Error(`PoHW ${name} differs from the installed verifier. Refusing silent overwrite.`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          await fs.writeFile(outputFile, contents, { flag: 'wx' });
        }
      }
      const destination = this.repoPath('.github/workflows/pohw-verify.yml');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const template = (await fs.readFile(path.join(this.context.extensionPath, 'templates/pohw-verify.yml'), 'utf8'))
        .replace('@@HASH_PROOF@@', hash(proof)).replace('@@HASH_CLI@@', hash(cli));
      try {
        const existing = await fs.readFile(destination, 'utf8');
        if (existing !== template) throw new Error('An existing PoHW workflow differs from the bundled template. Review it manually before updating.');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        await fs.writeFile(destination, template, { flag: 'wx' });
      }
      let readme = '';
      try { readme = await fs.readFile(this.repoPath('README.md'), 'utf8'); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
      await fs.writeFile(this.repoPath('README.md'), updateBadgeReadme(readme, badgeMarkdown(project.owner, project.repo, branch)));
      await this.refreshBaseline();
      void vscode.window.showInformationMessage('PoHW Badge initialized. Stop Monitoring or run Publish Signed Receipt, then commit .pohw/ and README.md, and push.');
    } catch (err) { void vscode.window.showErrorMessage(`PoHW Badge initialization failed: ${(err as Error).message}`); }
  }
  async publish(): Promise<void> {
    try {
      this.repositoryIdentity();
      if (this.active) throw new Error('Stop Monitoring before publishing a signed receipt.');
      if (vscode.workspace.textDocuments.some(d => d.isDirty && this.path(d.uri))) throw new Error('Save all source files before publishing.');
      const { privateKeyPem, publicKeyPem } = await this.localKeyPair();
      await this.registeredKey(publicKeyPem);
      await this.refreshBaseline();
      const manifest = codeManifest(this.root!.uri.fsPath);
      const known = new Map(this.engine.report().files.map(f => [f.path, f]));
      let units = 0, monitoredUnits = 0, weightedScore = 0;
      for (const f of manifest.files) {
        const local = known.get(f.path);
        if (!local) throw new Error(`PoHW cannot track code file: ${f.path}. Check monitoring limits.`);
        units += local.units;
        monitoredUnits += local.verifiedUnits;
        weightedScore += (local.score ?? 0) * local.verifiedUnits;
      }
      const body: ReceiptBody = {
        schema: 'pohw-editing-receipt/v1', claim: 'self-attested-editor-behavior',
        issuedAt: new Date().toISOString(), keyId: keyFingerprint(publicKeyPem),
        code: { rootHash: manifest.rootHash, files: manifest.files.length, algorithm: manifest.algorithm },
        metrics: { scorePercent: monitoredUnits ? Math.round(weightedScore / monitoredUnits * 10000) / 100 : null,
          coveragePercent: units ? Math.round(monitoredUnits / units * 10000) / 100 : 0,
          units, monitoredUnits, algorithm: 'rule-based-v0.1' },
        session: { startedAt: this.startedAt, endedAt: this.stoppedAt, auditTip: this.tip }
      };
      const receipt = issueReceipt(body, privateKeyPem);
      verifySignedReceipt(receipt, publicKeyPem, manifest);
      await fs.writeFile(this.repoPath('.pohw/receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
      void vscode.window.showInformationMessage(`PoHW signed receipt published locally: ${body.metrics.scorePercent ?? 'N/A'}% editing score, ${body.metrics.coveragePercent}% coverage. Commit and push to trigger CI.`);
    } catch (err) { void vscode.window.showErrorMessage(`PoHW receipt publication failed: ${(err as Error).message}`); }
  }
  async report(): Promise<void> {
    if (!this.root) { void vscode.window.showWarningMessage('Open one workspace folder to use PoHW.'); return; }
    const r = this.engine.report();
    const lines = [
      '# PoHW Coding Provenance Report', '',
      `**Status:** ${this.active ? 'Recording' : 'Paused'}`,
      `**Human editing evidence score:** ${fmt(r.score)} (monitored coverage only)`,
      `**Monitored coverage:** ${fmt(r.coverage)}`,
      `**Unverified code:** ${r.units - r.verifiedUnits} / ${r.units} non-whitespace characters`,
      `**Started:** ${this.startedAt ?? 'N/A'}`,
      `**Stopped:** ${this.stoppedAt ?? 'N/A'}`,
      `**Baseline Git HEAD:** ${this.baselineHead ?? 'N/A'}`,
      `**Audit chain tip:** \`${this.tip}\``,
      '',
      '> This is a rule-based editing-pattern score, **not** a calibrated probability of human authorship. No 95% confidence interval is available without labeled validation data.',
      '> Editor/API changes, keystroke emulation, and off-device AI assistance cannot reliably be distinguished in v0.',
      '', '| File | Score | Coverage | Incremental | Bulk | External | Baseline |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...r.files.filter(f => f.units > 0).map(f =>
        `| \`${f.path.replace(/\|/g, '\\|')}\` | ${fmt(f.score)} | ${fmt(f.coverage)} | ${f.byOrigin.incremental} | ${f.byOrigin.bulk} | ${f.byOrigin.external} | ${f.byOrigin.baseline} |`),
      '', '## Recent events (last 30)', '',
      ...this.recentEvents.slice(-30).reverse().map(e => `- ${e.time} \`${e.path}\` ${e.kind} (+${e.added}/-${e.removed})`), ''
    ];
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') });
    await vscode.window.showTextDocument(doc, { preview: true });
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.active) { this.active = false; this.stoppedAt = new Date().toISOString(); void this.write(); }
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
    vscode.commands.registerCommand('pohw.publishReceipt', () => monitor.publish()));
  await monitor.prepare();
}
export function deactivate(): void { /* disposed by VS Code */ }