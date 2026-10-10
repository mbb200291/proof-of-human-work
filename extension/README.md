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

Use **Extensions: Install from VSIX...** for the generated package. For debugging, open `extension/` in VS Code and press **F5**.

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

The verifier reads the committed Git tree and checks the receipt's Ed25519 signature and content digest.

## Operational notes

- **Missing/transparent badge:** The latest receipt failed validation, or the badge branch has not been published. Inspect the repository's `PoHW Receipt Verification` workflow and check Actions write permissions.
- **Stale badge:** GitHub image caches or workflow delays may delay an update. The report records the verified source commit.
- **Missing evidence:** Synchronize the exact source commit and rerun CI.
- **Existing badge installation:** Run **PoHW: Enable GitHub Badge** after upgrading the extension; review and commit the updated generated files once.
- **Signing keys:** The private key is stored in local VS Code extension `globalStorage`. Securely back it up. A lost key requires an explicit public-key rotation.

## Assurance and privacy

The score is an **uncalibrated editing-behavior heuristic**. Signatures confirm attribution to a locally held key and correspondence with the committed source code. AI agents can simulate small editor events, and off-device AI assistance cannot be excluded. No statistically calibrated human-authorship probability or 95% confidence interval is provided.

The extension stores **tracked source text** and activity metadata locally. Receipts and badges do not contain raw source text. Limit use to projects compatible with these local retention requirements. Multi-cursor edits, formatter output, branch switches and other complex editing patterns can be classified conservatively.
