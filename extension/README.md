# PoHW Coding Monitor — Extension Guide

VS Code extension for capturing editing provenance and publishing signed Git commit evidence.

## Requirements

- VS Code 1.90+
- Node.js 20+ and npm for source builds
- One workspace folder per monitoring session
- Git and an accessible GitHub `origin` remote for badges

## Build and debug

```bash
cd extension
npm install
npm test
npm run package
```

Use **Extensions: Install from VSIX...** for the generated package, or [download the latest successful `main` build](https://github.com/mbb200291/proof-of-human-work/releases/download/continuous/pohw-coding-monitor.vsix) directly. For debugging, open `extension/` in VS Code and press **F5**.

## Commands

| Command | Description |
| --- | --- |
| `PoHW: Start Monitoring` | Start a recording session |
| `PoHW: Stop Monitoring` | Stop recording and persist results |
| `PoHW: Show Provenance Report` | Display the read-only report |
| `PoHW: Enable GitHub Badge` | Initialize/update badge and verification files |
| `PoHW: Sync Commit Evidence` | Synchronize evidence for current Git HEAD; retry push |
| `PoHW: Publish Signed Receipt` | Legacy alias for Sync Commit Evidence |

Sessions begin explicitly. Files present before monitoring remain Unverified until a tracked edit changes their provenance. Monitoring does not resume automatically after a VS Code restart.

## Editing evidence

- `onDidChangeTextDocument` records edit events; `onDidSaveTextDocument` records saves.
- A rule-based scorer considers change size and incremental edits, revisions, deletions, and exact text moves. Exact moves can inherit provenance.
- Surviving text spans retain their tracked scores; external or unattributed changes remain Unverified.
- **Human Editing Evidence Score** is calculated over attributed text only. **Monitored Coverage** measures the attributed share of current eligible code.
- Counting uses non-whitespace UTF-16 code units. Coverage of 0% yields a score of N/A.
- The report opens in a read-only Webview. Recorded state survives between sessions in VS Code extension `globalStorage`.

Supported formats and limits are controlled by extension settings.

| Setting | Default | Purpose |
| --- | --- | --- |
| `pohw.maxFileBytes` | `524288` | Maximum monitored file size (bytes) |
| `pohw.maxFiles` | `2000` | Maximum files initialized |
| `pohw.include` | `**/*` | Included workspace paths |
| `pohw.exclude` | `**/{.git,node_modules,dist,out,build,coverage,.venv,venv,.pohw}/**` | Excluded paths |
| `pohw.evidenceAutoPush` | `true` | Push signed evidence to `origin` automatically |

## GitHub verification

1. Open a Git repository root with a GitHub `origin` remote.
2. Run **PoHW: Enable GitHub Badge** and specify its actual default branch. The extension creates or updates:
   - `.pohw/public-key.pem`, `.pohw/proof.js`, `.pohw/verify.cjs`
   - `.github/workflows/pohw-verify.yml`
   - An embedded badge block in the repository's `README.md`
3. Review, commit, and push the generated setup files on the default branch once. Grant GitHub Actions **Read and write permissions** for publishing `pohw-badges`.
4. Commit source changes normally. While the extension is active, PoHW checks for commits approximately every five seconds, signs the corresponding source commit and pushes the receipt to `pohw-evidence`.
5. Push the source branch normally. On the default branch, GitHub Actions checks the signed receipt and source tree and publishes `badge.svg`, `summary.json`, and `REPORT.md` to `pohw-badges`.

| Ref/branch | Content |
| --- | --- |
| Source default branch | Project source code and one-time setup files |
| `pohw-evidence` | Signed receipts at `receipts/<source-commit-sha>.json` |
| `pohw-badges` | CI-controlled badge SVG, metrics and verification report |

No additional source-code commit is required for each receipt. PoHW uses an independent Git index and Git object operations; the active HEAD, staging area, and working tree are preserved. If a committed file does not exactly match the monitored buffer, its content is treated as Unverified for that commit.

For source commits created while VS Code was closed, remote merge commits, or failed evidence pushes, check out/fetch the target commit locally and run **PoHW: Sync Commit Evidence**. CI waits up to roughly 90 seconds for matching evidence; rerun the workflow if evidence arrived after that interval.

To disable automatic evidence pushes, set `pohw.evidenceAutoPush` to `false`. Push manually with:

```bash
git push origin refs/pohw/evidence:refs/heads/pohw-evidence
```

### Manual verification

With `HEAD` set to the source commit to verify:

```bash
git fetch origin pohw-evidence
sha=$(git rev-parse HEAD)
git show "FETCH_HEAD:receipts/$sha.json" > /tmp/pohw-receipt.json
node .pohw/verify.cjs . /tmp/pohw-receipt.json /tmp/pohw-summary.json
```

The public verifier checks the receipt's Ed25519 signature and committed content digest. Its output sets `scoreVerification: not-recomputed`; it does not have the local event log.

### Independent event replay

Version 0.4.0 stores a complete append-only JSONL journal in extension `globalStorage`. **Show Provenance Report → Local event log** displays its absolute path. The first record identifies `pohw-event-log/v1`, `rule-based-v0.1`, the log ID and UTF-16 offsets. Events include baselines, editor edits, external reconciliations, saves and session boundaries, with sequence, previous/event hashes and before/after content hashes. Only the recent-event UI view is capped; the journal is never pruned automatically.

New receipt/v2 bodies include a signed `eventLog` commitment: log ID, algorithm, event count and tip. Receipt creation independently replays that persisted prefix and computes metrics for the exact Git commit. A later valid suffix does not change an older receipt. Already-published receipts remain immutable, including legacy receipts without replay commitments.

After building this extension, an authorized verifier can run:

```bash
node /path/to/proof-of-human-work/extension/scripts/verify-event-log.cjs \
  /path/to/source-repository \
  /path/to/receipt.json \
  /path/to/trusted-public-key.pem \
  /path/to/local.events.jsonl
```

The repository must contain the receipt's target Git commit. Use the repository's registered public key. The command requires no VS Code host or private key. It verifies signature, source manifest, log identity, sequence, chain links, edit ranges, content hashes, session metadata and recomputed metrics. It exits nonzero on mismatch. JSON output contains commit metrics, file reports and segment offsets/lengths/scores/origins, without source text. Files whose replayed content differs from the commit are entirely Unverified for that commit, including partial staging.

| Available evidence | Verification scope |
| --- | --- |
| Public receipt, registered key, Git commit | Signature and committed source; scores remain self-attested |
| Above plus matching complete journal prefix | Event consistency, exact replay and recomputed segment/commit scores |

Journal contents remain self-attested. An attacker controlling the machine and key can fabricate a new internally consistent history. P0 provides no trusted timestamp, remote checkpoint or proof of physical human input.

### Storage and upgrade

- Old `<workspace-id>.json` data is retained untouched. Without full historical edits, its scores cannot be replayed and are not imported. Current files establish new Unverified baselines.
- Journals contain full baseline text and inserted/deleted historical code, potentially including secrets. They are never included in evidence pushes. Share only with authorized verifiers; closing VS Code before making a manual copy avoids a partial trailing line.
- Recording appends synchronously; stop/receipt issuance flushes to disk. Memory retains current provenance plus a small UI event cache. Storage and startup replay time grow with the complete history.
- A partial or corrupt log blocks monitoring and receipt issuance; it is not silently truncated or replaced. Preserve the file for inspection. Restoring a complete backup may recover an earlier valid prefix; it cannot recover later evidence that was lost.
- One extension host may write a workspace journal at a time. A second host reports an evidence error; reload it after the first host exits. Locks from terminated processes are reclaimed. Inspect an unreadable/ambiguous lock, or a `.lock.recovery` guard left by a crash during recovery, before removing it manually.
- Restart replays existing evidence and remains paused. Offline changes are reconciled as unverified; a previously unfinished session is closed at recovery time. Local timestamps are untrusted observations, including that recovery time.
- Existing badge installations should regenerate their setup files with **Enable GitHub Badge** to display the updated verification scope.

## Operational notes

- **Missing/transparent badge:** The latest receipt failed validation, or the badge branch has not been published. Inspect the repository's `PoHW Receipt Verification` workflow and check Actions write permissions.
- **Stale badge:** GitHub image caches or workflow delays may delay an update. The report records the verified source commit.
- **Missing evidence:** Synchronize the exact source commit and rerun CI.
- **Existing badge installation:** Run **PoHW: Enable GitHub Badge** after upgrading the extension; review and commit the updated generated files once.
- **Signing keys:** The private key is stored in local VS Code extension `globalStorage`. Securely back it up. A lost key requires an explicit public-key rotation.

## Assurance and privacy

The score is an **uncalibrated editing-behavior heuristic**. Signatures confirm attribution to a locally held key and correspondence with the committed source code. AI agents can simulate small editor events, and off-device AI assistance cannot be excluded. No statistically calibrated human-authorship probability or 95% confidence interval is provided.

The extension stores **tracked source text** and activity metadata locally. Receipts and badges do not contain raw source text. Limit use to projects compatible with these local retention requirements. Multi-cursor edits, formatter output, branch switches and other complex editing patterns can be classified conservatively.
