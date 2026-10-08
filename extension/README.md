# PoHW Coding Monitor (v0.3.2 — Verified Report Links)

Local VS Code extension that records document changes and saves while a monitoring session is active. It calculates a **rule-based editing-behavior evidence score** and tracks which current code spans have monitor evidence.

## Requirements & local launch

- VS Code 1.90 or newer, Node.js 20+ and npm.
- Open the `extension/` directory itself in VS Code.
- In the VS Code terminal run `npm install`, then `npm test`.
- Press **F5**, select **Run PoHW Extension** if asked. This opens a second **Extension Development Host** window.
- In that new window, **File → Open Folder** to open a test code project (exactly one workspace folder).
- Command Palette: `PoHW: Start Monitoring`. Edit and save code. Select `PoHW: Show Provenance Report` or click the PoHW status bar item to open a **read-only Webview** (no `Untitled` file or unsaved dot; repeated opens reuse the panel). Finish with `PoHW: Stop Monitoring`.
- To build an installable `.vsix` package: `npm run package`, then VS Code → **Extensions: Install from VSIX...**.

> **v0.3.1 note:** This release fixes first-time publication of the independent `pohw-badges` branch. If a project has already initialized badges, rerun `PoHW: Enable GitHub Badge`, accept the workflow template update, and commit/push the updated `.github/workflows/pohw-verify.yml` once. The score receipt remains on `pohw-evidence`; no new source-code commit is required for the verifier fix.

## GitHub Badge + signed Commit Evidence (v0.3)

**v0.3.2 update:** The Editing Score and Monitored badges link to a CI-generated `pohw-badges/REPORT.md` containing validated metrics, the source commit and code digest, and the signed receipt link. The Receipt Verification badge still links to the repository's GitHub Actions workflow. For previously enabled repositories, rerun `PoHW: Enable GitHub Badge`, review and commit the updated `.github/workflows/pohw-verify.yml` and README badge block once, then push the default branch.


The badge is opt-in per GitHub repository. Open the **repository root** in VS Code. Each signed receipt is bound to the **SHA of an already-created source commit**; the evidence record is committed in `pohw-evidence`, independently of the user's working tree and staging area. The Ed25519 private key stays in VS Code extension `globalStorage`. No private key or raw source is uploaded in the receipt.

### One-time setup / upgrade from v0.2

1. Install v0.3 and run **`PoHW: Enable GitHub Badge`**; select your *actual GitHub default branch* (`main`, `dev`, etc.). This generates or updates:
   - `.pohw/public-key.pem` (existing signer retained), `.pohw/proof.js`, `.pohw/verify.cjs`;
   - `.github/workflows/pohw-verify.yml` (new cross-branch verifier);
   - Badge block inside `README.md`.
2. When upgrading from v0.2, approve replacement of the **generated** verifier/workflow files when prompted. Check changes before committing. An old tracked `.pohw/receipt.json` is not used in v0.3; you may remove this **legacy** file with a normal commit.
3. **Only for this initial setup or upgrade**, commit and push those generated setup files to your repository's default branch in your normal Git workflow. This is necessary for GitHub Actions to run. PoHW never commits your source or initial setup automatically.
4. Permit Actions to write to `pohw-badges` (`Settings → Actions → General → Workflow permissions → Read and write permissions`). Ordinary Git authentication must permit the local process to push `pohw-evidence` to `origin`.

### Everyday use — no extra `git commit` for receipts

1. Start monitoring, edit and save as normal, stop monitoring whenever you like. `PoHW: Show Provenance Report` is a read-only Webview.
2. **Commit your code exactly as you normally do** (`git commit` or VS Code Source Control). About every 5 seconds while VS Code is open, PoHW checks for new local commits. It signs each newly detected commit, writes an independent evidence commit to local `refs/pohw/evidence`, and automatically pushes that ref to remote **`pohw-evidence`**. It does not stage, commit, checkout, or push your source branch.
3. **Push your ordinary source branch normally.** On source push, GitHub Actions waits up to approximately 90 seconds for the matching `pohw-evidence/receipts/<source-sha>.json`, verifies signature and source contents from the exact source commit, then (on the default branch) publishes verified `summary.json` to `pohw-badges`.
4. Badges in the README read only the CI-published `pohw-badges` JSON and verification workflow status. Failed or missing receipt checks do not refresh numeric badges; the previous values may be stale.

If a commit was created while VS Code was closed, or merged on GitHub's website, open that Git commit in the local repo and execute **`PoHW: Sync Commit Evidence`**. This also retries failed evidence pushes. It does **not** create a normal source commit; use this command only when necessary. The legacy command `PoHW: Publish Signed Receipt` is an alias.

To disable automatic network pushes, set `pohw.evidenceAutoPush: false`. In that case evidence is generated locally only; manually push the independent ref with:

```sh
git push origin refs/pohw/evidence:refs/heads/pohw-evidence
```

### Independent verification

```sh
git fetch origin pohw-evidence
sha=$(git rev-parse HEAD)
git show "FETCH_HEAD:receipts/$sha.json" > /tmp/pohw-receipt.json
node .pohw/verify.cjs . /tmp/pohw-receipt.json /tmp/pohw-summary.json
```

The checked-out HEAD must match the receipt's target commit. The verifier independently reads the Git **commit tree**, never uncommitted working-tree contents.

### Git safety & limitations

- PoHW creates evidence commits with a **temporary `GIT_INDEX_FILE`**, `git write-tree`, and `git commit-tree`. It never changes the user's HEAD, staged index, unstaged files, or Git hooks/settings. Staged, unstaged, partially staged and untracked files can coexist. Branch checkout and merge/rebase states don't trigger source commits themselves.
- Provenance scoring remains conservative: only a committed file **exactly matching its tracked editor buffer** inherits its measured score. If the developer partially staged changes, the mismatched file is counted as **Unverified** for that commit, not incorrectly scored. The receipt still verifies the actual committed code.
- Source commits that were already pushed before evidence synchronization may briefly fail CI; the workflow retries fetching evidence for about 90 seconds. A delayed local sync may require rerunning the failed Action.
- If GitHub Actions merges a PR on the server, the generated merge commit was not seen by the local plugin; use `PoHW: Sync Commit Evidence` on the fetched merge commit before rerunning Actions.
- Automatic pushing of the evidence branch requires normal `origin` Git credentials and no branch-protection restrictions. On failure, the local evidence ref remains for retry; check PoHW messages. Multi-machine conflicts are handled without force pushing; divergence requires manual recovery.
- Evidence records are self-attested. Signature validity and commit matching **do not prove human cognitive authorship**. Scores are uncalibrated heuristics and have no statistically valid 95% CI.
- Back up the local signing key securely. Losing the key requires an explicit public-key rotation/reset. This is a research prototype, not hardened endpoint attestation.
- Only supported code/text files (subject to the existing file policy and per-file size limit) participate in the source digest. Unsupported files are excluded, not silently certified.

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

The end-to-end design background lives in [`docs/applications/verifiable-human-coding-session.md`](https://github.com/mbb200291/proof-of-human-work/blob/main/docs/applications/verifiable-human-coding-session.md).