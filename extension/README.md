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

## Runtime performance

- Monitoring remains **manual**. When paused, the extension still checks for Git commits roughly every five seconds in badge-enabled repositories.
- In-memory core edit history is capped at 128 entries; recent user-facing audit events remain capped at 1,000. Scoring and signed receipts retain their existing provenance data.
- Editing events update affected spans; whole-file SHA-256 is deferred until save or a persistence checkpoint. The hash-chained event log records the hashed edit delta between checkpoints.
- Status-bar summaries are refreshed at most once per 350 ms during editing. Unchanged report results are cached.
- Local state is written after five seconds of inactivity or at most 30 seconds of sustained editing. Stop Monitoring flushes immediately. Writes are serialized.
- The diagnostic performance test reports elapsed time and heap growth for 2,000 edits in a 100 KiB file. Timings depend on the machine and are not used as release gates.

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
5. Push the source branch normally. On the default branch, GitHub Actions checks the signed receipt and source tree and publishes separate `editing.svg` and `coverage.svg` badges, `summary.json`, and `REPORT.md` to `pohw-badges`.

| Ref/branch | Content |
| --- | --- |
| Source default branch | Project source code and one-time setup files |
| `pohw-evidence` | Signed receipts at `receipts/<source-commit-sha>.json` |
| `pohw-badges` | CI-controlled editing and coverage SVGs, metrics and verification report |

No additional source-code commit is required for each receipt. PoHW uses an independent Git index and Git object operations; the active HEAD, staging area, and working tree are preserved. A new receipt carries signed file-level code-span attribution. For merges, the monitor reconstructs unchanged spans from parent commits and recent signed evidence. Exact whole-file renames and unique matching lines can retain scores; unmatched changes remain Unverified. Local monitored conflict-resolution edits take precedence when the saved file exactly matches the target commit.

Existing v2 receipts can still be verified, but have no span-level history for retroactive inheritance. v0.3.5 introduces signed span snapshots (v3). For squash merges, matching uses recent evidence, so old or heavily rewritten source may require additional provenance rather than automatic recovery. The verification key and per-repository workflow generated by `PoHW: Enable GitHub Badge` must be upgraded once.

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

The verifier reads the committed Git tree and checks the receipt's Ed25519 signature and content digest.

## Operational notes

- **Missing/transparent badges:** The latest receipt failed validation, or the badge branch has not been published. Inspect the repository's `PoHW Receipt Verification` workflow and check Actions write permissions.
- **Stale badges:** GitHub image caches or workflow delays may delay an update. The report records the verified source commit.
- **Missing evidence:** Synchronize the exact source commit and rerun CI.
- **Existing badge installation:** After upgrading to v0.3.6, run **PoHW: Enable GitHub Badge** to update both the README badge block and CI workflow; review, commit, and push the generated changes once.
- **Signing keys:** The private key is stored in local VS Code extension `globalStorage`. Securely back it up. A lost key requires an explicit public-key rotation.

## Assurance and privacy

The score is an **uncalibrated editing-behavior heuristic**. Signatures confirm attribution to a locally held key and correspondence with the committed source code. AI agents can simulate small editor events, and off-device AI assistance cannot be excluded. No statistically calibrated human-authorship probability or 95% confidence interval is provided.

The extension stores **tracked source text** and activity metadata locally. Receipts and badges do not contain raw source text. Limit use to projects compatible with these local retention requirements. Multi-cursor edits, formatter output, branch switches and other complex editing patterns can be classified conservatively.
