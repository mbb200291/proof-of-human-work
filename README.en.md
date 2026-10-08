# Proof of Human Work (PoHW)

**Language:** [繁體中文](README.md) | [English](README.en.md)

[![VS Code Extension CI](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml/badge.svg?branch=main)](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml)
[![Coding Monitor Version](https://img.shields.io/badge/Coding%20Monitor-v0.3.2-blue)](https://github.com/mbb200291/proof-of-human-work)
![License](https://img.shields.io/badge/license-MIT-green)

> Researching traceable and verifiable evidence of human participation in digital work.

**Proof of Human Work (PoHW)** is a research project at the intersection of systems security and human–computer interaction. Its first usable prototype, **PoHW Coding Monitor**, is a VS Code extension that records source-code editing history, computes rule-based evidence of human-like editing behavior, binds signed evidence to Git commits, and publishes verification results through GitHub Actions and README badges.

> **Scope of assurance:** The **Human Editing Evidence Score is an uncalibrated heuristic**, not a probability that code was authored by a human. Signatures and CI can establish that a self-attested receipt matches a particular commit; they cannot establish that no AI assistance was used.

## Features and current status

| Feature | Status |
| --- | --- |
| Start/stop VS Code monitoring; capture document edits and save events | Implemented |
| Rule-based Human Editing Evidence Score | Implemented; not statistically calibrated |
| Monitored Coverage, unverified spans, provenance preservation on code moves | Implemented, with limitations |
| Read-only provenance report in VS Code Webview | Implemented |
| Ed25519-signed receipts bound to Git commit SHA | Implemented |
| Independent `pohw-evidence` branch; automatic evidence creation and push | Implemented; requires Git credentials |
| GitHub Actions verification and README badges | Implemented; requires per-repository setup |
| Calibrated human-authorship probability and 95% confidence interval | Not provided |
| Tamper-resistant endpoint, physical keyboard attestation, full cross-commit span lineage | Not implemented |

See the [extension documentation](extension/README.md) and [verifiable coding-session design](docs/applications/verifiable-human-coding-session.md).

## 1. Install the VS Code extension

**Requirements:** VS Code 1.90 or newer. This research prototype is not yet published to the VS Code Marketplace. Install a VSIX built by GitHub Actions, or build it locally.

**Install a VSIX:**

1. Open the [VS Code Extension CI workflow](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml), select a recent successful run, and download and extract the `pohw-coding-monitor-vsix` artifact.
2. In VS Code, run **Extensions: Install from VSIX...** and select the extracted `.vsix`.
3. If the workflow artifact has expired, follow the local build steps below.

**Build and test locally (Node.js 20+ and npm):**

```bash
git clone https://github.com/mbb200291/proof-of-human-work.git
cd proof-of-human-work/extension
npm install
npm test
npm run package  # produces a .vsix
```

For extension development, open the `extension/` folder in VS Code and press **F5** to launch the Extension Development Host. Open a test project in the new window.

## 2. Start monitoring and inspect the results

Open **one workspace folder** in VS Code. Use the Command Palette (**Cmd+Shift+P** on macOS; **Ctrl+Shift+P** on Windows/Linux).

1. Run **PoHW: Start Monitoring** to capture the initial workspace state and begin recording edits.
2. Edit and save files as usual. The extension records document-change events and save events.
3. Run **PoHW: Show Provenance Report** to view scores, coverage, and file provenance in a read-only Webview; it will not create an unsaved `Untitled` document.
4. Run **PoHW: Stop Monitoring** to end the session and retain its results. When monitoring resumes, existing spans can retain their provenance if their content still matches.

| Command | Purpose |
| --- | --- |
| **PoHW: Start Monitoring** | Start monitoring the current workspace |
| **PoHW: Stop Monitoring** | Stop monitoring and persist results |
| **PoHW: Show Provenance Report** | Open the read-only report |
| **PoHW: Enable GitHub Badge** | Initialize or upgrade badges for a GitHub repository |
| **PoHW: Sync Commit Evidence** | Manually synchronize evidence for the current HEAD or retry a push |
| **PoHW: Publish Signed Receipt** | Legacy alias for Sync Commit Evidence |

**How to interpret the metrics:**

- **Human Editing Evidence Score** is the rule-based editing-pattern score over monitored, attributed code only.
- **Monitored Coverage** is the fraction of the current eligible code with monitored provenance. It uses non-whitespace UTF-16 code units as its counting unit.
- **Unverified** includes code predating monitoring, changes made while monitoring is paused, external writes, and regions that cannot be reconciled to a commit. **Unverified does not mean AI-generated or 0% human.**
- When coverage is 0%, the score is **N/A**. No statistically justified 95% confidence interval is available.

Monitoring does **not** automatically resume following a VS Code restart; run Start again. The extension cannot reconstruct a complete edit history from older VS Code Timeline entries.

## 3. Enable GitHub badges for your repository

**Enabling the badge is opt-in.** Merely starting the monitor does not modify your README or automatically configure a GitHub repository.

1. Open the **Git repository root** in VS Code and ensure the `origin` remote points to GitHub.
2. Run **PoHW: Enable GitHub Badge** and select the repository's **actual default branch**, such as `main` or `dev`.
3. The extension creates or updates `.pohw/public-key.pem`, `.pohw/proof.js`, `.pohw/verify.cjs`, `.github/workflows/pohw-verify.yml`, and the badge block in `README.md`.
4. **Commit and push these configuration files through your normal Git workflow once**, or again when upgrading the verifier/workflow template.
5. In GitHub repository **Settings → Actions → General → Workflow permissions**, allow Actions to write repository contents, and ensure branch rules permit publishing to `pohw-badges`. Your local Git credentials must allow pushing `pohw-evidence` to `origin`.

The Ed25519 **private key stays in local VS Code extension `globalStorage`**, not in the Git repository. Back it up securely. Losing it requires an explicit rotation of the repository's registered public key before issuing new evidence.

### Everyday workflow: no extra PoHW commits

```text
PoHW: Start Monitoring → Edit and save → PoHW: Stop Monitoring
                                   ↓
                          Your normal git commit
                                   ↓
                     PoHW detects the new local commit
                                   ↓
                      Sign receipt and push pohw-evidence
                                   ↓
                           Your normal git push
                                   ↓
                       GitHub Actions verifies receipt
                                   ↓
                  Update pohw-badges and README badges
```

When the repository is initialized and the VS Code extension is active, PoHW checks for new local commits approximately every **five seconds**. It never commits or pushes your **source-code branch** for you. It creates independent evidence commits using a temporary Git index and low-level Git object operations without altering your HEAD, staging area, or unstaged/untracked files. If a partially staged file cannot be reliably reconciled to monitored content, its contribution is conservatively marked Unverified.

| Branch | Purpose |
| --- | --- |
| `main` / `dev` (actual default branch) | Your source code and initial configuration |
| `pohw-evidence` | Signed receipts indexed as `receipts/<commit-sha>.json`; never merged into the source branch |
| `pohw-badges` | CI-verified `summary.json` and `REPORT.md` for badges and detailed verification |

If you commit while VS Code is closed, merge via GitHub's web UI, or encounter a failed evidence push, first fetch the relevant source commit locally, then run **PoHW: Sync Commit Evidence**. On source pushes, CI waits up to about **90 seconds** for evidence matching the source commit. If the wait expires, synchronize the evidence and rerun the workflow.

**Disable automatic evidence push:** Set `pohw.evidenceAutoPush` to `false` in VS Code Settings, then push the evidence ref manually when desired:

```bash
git push origin refs/pohw/evidence:refs/heads/pohw-evidence
```

### Manually verify a receipt

The local HEAD must correspond to the commit being checked:

```bash
git fetch origin pohw-evidence
sha=$(git rev-parse HEAD)
git show "FETCH_HEAD:receipts/$sha.json" > /tmp/pohw-receipt.json
node .pohw/verify.cjs . /tmp/pohw-receipt.json /tmp/pohw-summary.json
```

The verifier compares the **Git commit tree** with the receipt and signature; it does not treat uncommitted working-tree contents as verified source code.

### Badge destinations and detailed verification report

- The **Coding Monitor version** badge on this repository links to the [PoHW homepage](https://github.com/mbb200291/proof-of-human-work).
- **PoHW Editing Score** and **PoHW Monitored**, when installed in another repository, link to that repository's **`pohw-badges/REPORT.md`**. CI generates this report only from successfully validated results, including the score, coverage, source commit, content digest, and a link to the signed evidence receipt.
- **PoHW Receipt Verification** links to that repository's GitHub Actions verification workflow.

Numeric badges show the **last successfully verified** result, which may become stale if a later commit fails verification. Compare the report's source commit with the current default branch and check the workflow status.

**Upgrading an existing badge configuration to v0.3.2:** Re-run **PoHW: Enable GitHub Badge**, review and commit the updated README badge block and `.github/workflows/pohw-verify.yml` once, then push to the repository's default branch. The next successful CI publication creates `REPORT.md` on `pohw-badges`. No separate receipt commit is needed.

## 4. Troubleshooting

| Symptom | Cause / resolution |
| --- | --- |
| Score badge says `resource not found` | No successful publication of `pohw-badges/summary.json`; inspect the workflow's verify/publish jobs |
| Verification badge says `no status` | Ensure the workflow and README branch parameter match the actual default branch |
| Detailed report is unavailable | Upgrade the workflow and wait for a successful run that publishes `pohw-badges/REPORT.md` |
| CI reports missing evidence | There is no receipt for that source SHA in `pohw-evidence`; run Sync for the same HEAD, then rerun the workflow |
| First badge-branch publication fails | Use v0.3.1 or later to refresh the workflow template, and confirm GitHub Actions write permissions |
| Score is N/A and coverage is 0% | The commit has no attributable monitored spans or does not match the local tracked state |
| Provenance becomes Unverified after checkout | Branch switching, pulling, or merging cannot automatically be attributed to manual edits |
| Existing v0.2 badge setup | Rerun Enable GitHub Badge to update the template; the older `.pohw/receipt.json` is no longer used |
| Change the default branch | Update the real GitHub repository default branch and rerun Enable GitHub Badge to refresh links |

## 5. Scoring, security, and privacy limitations

The rule-based prototype considers edit size, incremental editing, local revisions, deletions/rewrites, and exact cut-and-paste moves. Provenance labels follow surviving code spans. Automated tests cover four patterns: bulk AI-agent generation, manual edits plus Stack Overflow pastes, manually written scaffolding plus pasted AI-generated functions, and manual code rearrangement. **Passing those tests only demonstrates expected heuristic behavior, not reliable attribution of AI versus human authorship.**

- An agent can emulate small human-looking edits. A human can read AI output on a separate device and type it manually. Neither scenario can be reliably excluded by this version.
- Receipts are signed using a **self-attested local key**. Signature and content verification establish consistency and key attribution, not the cognitive origin of the code.
- The extension persists the **full text of tracked source files** and statistics in local VS Code extension storage. Consider the sensitivity of your source code and retention requirements before using the prototype. Public receipts and badges do not require publishing raw source code.
- Only one workspace folder and allowlisted text formats are supported. Defaults: **512 KiB per file**, up to **2,000 files**; configurable with `pohw.maxFileBytes`, `pohw.maxFiles`, `pohw.include`, and `pohw.exclude`.
- Physical keyboard attestation, hardened endpoints, continuous human-presence challenges, calibrated human-authorship probabilities, and 95% confidence intervals are not implemented.

## 6. Research background

PoHW's longer-term research plan distinguishes four dimensions of evidence, rather than producing an ambiguous `verified_human=true` flag:

| Evidence | Question |
| --- | --- |
| **U — Uniqueness** | Does the work correspond to a real and preferably unique human? |
| **P — Presence** | Was that person present during the work session? |
| **E — Endpoint Integrity** | Were the records produced by the expected endpoint/application, with resistance to forgery? |
| **C — Contribution** | Does the work product contain verifiable value? |

Private Interaction History (PIH), stronger presence verification, and hardware attestation remain research directions and are **not included in the current VS Code prototype**.

- [Proof of Human Participation research report](docs/research/proof-of-human-participation.md)
- [Phased implementation plan](docs/implementation-plan.md)
- [Verifiable Human Coding Session application design](docs/applications/verifiable-human-coding-session.md)
- [Advanced VS Code Extension documentation](extension/README.md)

## License

[MIT](LICENSE)
