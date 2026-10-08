# PoHW Coding Monitor (v0.2 — Signed Receipts & GitHub Badges)

Local VS Code extension that records document changes and saves while a monitoring session is active. It calculates a **rule-based editing-behavior evidence score** and tracks which current code spans have monitor evidence.

## Requirements & local launch

- VS Code 1.90 or newer, Node.js 20+ and npm.
- Open the `extension/` directory itself in VS Code.
- In the VS Code terminal run `npm install`, then `npm test`.
- Press **F5**, select **Run PoHW Extension** if asked. This opens a second **Extension Development Host** window.
- In that new window, **File → Open Folder** to open a test code project (exactly one workspace folder).
- Command Palette: `PoHW: Start Monitoring`. Edit and save code. Select `PoHW: Show Provenance Report` or click the PoHW status bar item. Finish with `PoHW: Stop Monitoring`.
- To build an installable `.vsix` package: `npm run package`, then VS Code → **Extensions: Install from VSIX...**.

## GitHub Badge + signed Receipt (Scheme B)

The badge feature is **opt-in per Git repository**. The VS Code extension must be opened at the **Git repository root** with a GitHub `origin` remote. It uses a self-attested Ed25519 key stored privately in VS Code extension **globalStorage**, scoped to the local repository. **No private key is committed.**

1. Open Command Palette → **`PoHW: Enable GitHub Badge`**; confirm the **default branch** (normally `main`). This operation is idempotent and adds:
   - `.pohw/public-key.pem` — the pinned self-attested signing identity;
   - `.pohw/proof.js` + `.pohw/verify.cjs` — standalone, dependency-free receipt verifier;
   - `.github/workflows/pohw-verify.yml` — validates the verifier hashes, signature, and current code snapshot;
   - an automatically generated Badge block in `README.md`.
2. Start monitoring, edit and save code, then **`PoHW: Stop Monitoring`**. If Badge is enabled, Stop **automatically signs** `.pohw/receipt.json`. You may rerun **`PoHW: Publish Signed Receipt`** after making further source changes. The extension must be stopped and all buffers saved before signing.
3. Run `git add -A` to stage your changed code, README, workflow and `.pohw/` files; `git commit` and `git push` to the default branch. **Never commit the local private key.**
4. On push, GitHub Actions checks the pinned local verifier, Ed25519 signature and source files. If validation succeeds on the **default branch**, the workflow publishes `summary.json` to a dedicated `pohw-badges` branch. The README's dynamic score/coverage badges read **only this CI-published branch**, not the locally generated receipt. A third badge shows the workflow status.
5. On subsequent code edits, Stop and commit the **new** receipt together with source changes; otherwise CI will reject the commit. If no valid receipt is present, the verify job fails and does **not** publish a new score. Previously published numeric badges may remain **stale** (use the workflow status badge and source commit in the JSON for freshness).

For manual verification without GitHub Actions:

```bash
node .pohw/verify.cjs . verified-summary.json
```

This requires Node.js 20+ and Git, but no npm dependencies. `verified-summary.json` is an output of **successful** verification only; do not commit it as an input to the verifier.

### Project requirements and operational limitations

- The GitHub repository must permit GitHub Actions to write to the `pohw-badges` branch. `contents: write` is requested by the `publish` job; repository settings or branch protections can still block it. The first successful default-branch run creates the badge branch.
- The source snapshot covers Git-indexed + untracked, non-ignored **code/text files** with supported extensions; excluded directories include `.git`, `.pohw`, `node_modules`, `build`, `dist`, etc. The receipt includes a sorted, canonical file-list digest and the CI re-derives it from the checked-out commit. This is a **content digest**, not a signed Git commit SHA: the receipt lives inside the commit and cannot sign that same commit hash without an external record.
- Stage and commit all source files before pushing. An unstaged deletion can prevent publication; an uncommitted source change after signing makes CI fail. When formatting or Git operations modify code, publish a new receipt.
- Score and coverage are heuristic and **self-attested**. A valid signature proves the pinned local key signed the report, while CI proves the checked-out eligible source files match the report. It does **not** prove the edits were human-generated, nor that the signer did not create a fake edit log. The repo owner can also rotate the trust root and/or edit the workflow; protect the default branch and workflow updates for any stronger organizational policy.
- Loss of the local signing key prevents updating the receipt under the existing pinned public key. Key rotation is an explicit trust reset, not an automatic regeneration. The key is stored in VS Code globalStorage; backing it up securely is the user's responsibility.
- The publicly readable Badge JSON contains percentage scores, source content hash, signed issue time and CI commit SHA, but no raw source code or local event history.

## Measurement behavior

- `onDidChangeTextDocument` drives edit classification; `onDidSaveTextDocument` records save events. It cannot reconstruct historical changes from VS Code Timeline before activation.
- Small incremental editor mutations usually score 0.84–0.94, while single large insertions score 0.10–0.38. Revisions increase evidence slightly.
- Identical text cut and pasted within 10 minutes inherits the cut portion's provenance (including across files in a session).
- Current code is tracked at the text-span level: delete removes attribution; untouched spans retain their scores. Counted units are **non-whitespace UTF-16 code units**.
- Existing baseline code, externally written code, content modified while paused, and checkout/pull-originated files without matching editor events are **unverified**, not 0% human.
- Report contains **score over monitored code** and **monitored coverage over current code** separately. Empty or entirely unverified workspaces have `N/A` score.
- Data are stored **locally**, including tracked source text, in the VS Code extension global storage directory. No server is contacted.
- An SHA-256 chained audit tip is included. Because v0 has no trusted clock, server or signatures, it is **not tamper-resistant proof**.
- The rule score is **not a probability of authorship** and it has **no statistically defensible 95% confidence interval** until calibrated using labeled human/agent sessions.

## Four target scenarios

1. **Agent-generated:** direct filesystem writes become `unverified`; large editor insertions get a low score.
2. **Manual + Stack Overflow:** incremental handwritten edits score high; bulk pasted snippets score lower, and local rewrites only affect modified spans.
3. **Manual scaffold + AI functions:** hand-edited scaffold has a high score but bulk-inserted generated function bodies have a low score.
4. **Manual code moved:** an exact cut/paste reuses original span scores without arbitrary penalty.

`npm test` includes automated scenarios and provenance invariants. These are **controlled event-pattern tests**, not evidence that the tool can determine whether pasted text came from an LLM rather than another human. An AI that emulates human-sized incremental edits can defeat v0's classifier.

## MVP limitations

- No keyboard hardware attestation, raw keypress detection, AI integration detection, cognitive authorship verification, or external verifier.
- An extension making small programmatic edits can look like a human; formatter and refactoring code are not reliably distinguished from ordinary edits.
- Git checkout/merge changes are deliberately unverified, and prior scores can only be retained when the exact tracked file content is unchanged or spans are preserved by reconciliation. Cross-commit provenance import is not implemented.
- Undo, multi-cursor edits, whitespace-changing moves, unusually long single insertions, and transient file writes may produce incorrect evidence scores.
- Limited to a **single workspace folder** and text extensions in the allowlist. Files over `pohw.maxFileBytes`, non-text files, ignored build directories and files beyond the `pohw.maxFiles` limit are not included.
- Monitoring resumes **only by explicit Start** after VS Code restarts. Changes since the last session are reconciled as unverified.
- If capturing confidential code is not acceptable, do not run this prototype. Delete the extension's globalStorage directory to erase stored local data.

The end-to-end design background lives in [`docs/applications/verifiable-human-coding-session.md`](https://github.com/mbb200291/proof-of-human-work/blob/feature/vscode-human-editing-mvp/docs/applications/verifiable-human-coding-session.md).