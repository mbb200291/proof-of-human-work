# PoHW Coding Monitor

[繁體中文](README.md) · [English](README.en.md)

[![VS Code Extension CI](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml/badge.svg?branch=main)](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml)
[![Version](https://img.shields.io/badge/Coding%20Monitor-v0.3.3-blue)](https://github.com/mbb200291/proof-of-human-work)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**PoHW Coding Monitor** is a VS Code extension for tracking the provenance of source-code edits. It records document changes and saves, computes an editing-behavior evidence score, and issues signed records bound to Git commits.

## Features

- **Edit monitoring** — Track document changes, saves, and provenance of surviving code spans.
- **Editing evidence** — Report Human Editing Evidence Score, Monitored Coverage, and unverified code. Exact code moves can retain their attribution.
- **Commit receipts** — Sign receipts with Ed25519 and store them on the independent `pohw-evidence` branch.
- **GitHub badge** — Verify signed receipts against source commits in GitHub Actions and publish a badge and report to `pohw-badges`.
- **Local report** — View per-file scores and recent editing activity in a read-only VS Code Webview.

## Installation

**Requires VS Code 1.90+.** Install a VSIX from GitHub Actions. The extension is not currently distributed through the VS Code Marketplace.

1. Open the [VS Code Extension CI workflow](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml) and select the latest successful run.
2. Download the `pohw-coding-monitor-vsix` artifact and extract the `.vsix`.
3. In VS Code, run **Extensions: Install from VSIX...**.

## Usage

Open a single project folder. Use the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux):

| Command | Action |
| --- | --- |
| `PoHW: Start Monitoring` | Start capturing editor changes |
| `PoHW: Show Provenance Report` | View scores, coverage, and provenance |
| `PoHW: Stop Monitoring` | Stop monitoring and persist local data |
| `PoHW: Enable GitHub Badge` | Configure or update GitHub verification |
| `PoHW: Sync Commit Evidence` | Recover or retry commit-evidence synchronization |

Edit and save normally while monitoring is active. After restarting VS Code, start monitoring again.

## GitHub badge

Run `PoHW: Enable GitHub Badge` at the **Git repository root** and select the repository's actual default branch (for example, `main` or `dev`).

The one-time setup creates the public key, verifier, GitHub Actions workflow, and README badge. **Commit and push these setup files once** using your normal Git workflow, and allow GitHub Actions write access. Subsequent development follows the existing workflow:

```text
Start Monitoring → Edit and save → Stop Monitoring
                               ↓
                       Normal git commit
                               ↓
                 PoHW signs and pushes pohw-evidence
                               ↓
                        Normal git push
                               ↓
                     GitHub Actions verifies
                               ↓
                        README badge updates
```

PoHW leaves your source branch and staging area untouched. While the extension is active, it checks for new local commits approximately every five seconds. Use `PoHW: Sync Commit Evidence` when synchronization needs to be retried or recovered.

## Metrics and assurance

| Metric | Meaning |
| --- | --- |
| **Human Editing Evidence Score** | Rule-based editing-pattern score across monitored code |
| **Monitored Coverage** | Proportion of current code with monitored provenance |
| **Unverified** | Code without attributable editing evidence; not counted as 0% human |

Scores are **uncalibrated heuristics**, not probabilities of human authorship. Receipts are self-attested using locally held keys. GitHub Actions verifies receipt signatures and consistency with the target commit. Simulated editing behavior and off-device AI assistance remain outside the current assurance.

The extension stores tracked source text and statistics in local VS Code extension storage. Public receipts and badges do not include raw source files.

## Development

Requires Node.js 20+ and npm.

```bash
git clone https://github.com/mbb200291/proof-of-human-work.git
cd proof-of-human-work/extension
npm install
npm test
npm run package
```

For interactive debugging, open `extension/` in VS Code and press **F5** to launch the Extension Development Host.

See the [extension documentation](extension/README.md) for configuration and verification details.

## License

[MIT](LICENSE)
