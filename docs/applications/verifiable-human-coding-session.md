# Application Design: Verifiable Human Coding Session

## 1. Problem statement

This application applies Proof of Human Work / Proof of Human Participation to software development.

The target user experience is a VS Code-based development session that can later produce evidence for a bounded claim such as:

> The submitted code was derived from a known workspace baseline through a recorded, integrity-protected editing session in which an authenticated human remained present.

The system must **not** collapse this claim into “the code was certainly conceived without AI.” A desktop editor cannot observe the developer's cognitive source. A human can read AI output on another device and manually re-enter it. Therefore the first design goal is **verifiable coding provenance**, with stronger human-participation evidence added in layers.

The useful distinction is:

- **Output detection:** infer whether final code looks AI-generated.
- **Process provenance:** record how the code changed during a session.
- **Human presence:** establish that a human was participating during that process.
- **Cognitive authorship:** establish that ideas came only from the human mind.

This application focuses on the middle two. Cognitive authorship remains outside the supported claim.

---

## 2. Intended use cases

Potential applications include:

1. coding examinations and take-home assignments;
2. programming contests or qualification tasks where AI assistance is restricted;
3. “human-only” software contribution experiments;
4. research datasets that need code with documented human editing provenance;
5. contracts or bounty systems that require evidence of human labor;
6. developer portfolio artifacts that optionally attach a verifiable work-session receipt.

The verifier should always decide the required assurance policy. A public open-source project may accept weak provenance, while a controlled examination may require an isolated editor environment and random presence checks.

---

## 3. Security claim

### 3.1 Primary claim

The first implementable claim is:

> Between session start and session finalization, the verifier can reconstruct or validate an integrity-protected chain of workspace changes from a declared baseline to the submitted result, and can identify changes that did not pass through the monitored workflow.

This establishes **editing provenance**, not absolute human authorship.

### 3.2 Stronger optional claim

With a controlled VS Code instance and presence checks:

> The workspace was edited inside a constrained development environment during a session in which an authenticated human repeatedly demonstrated presence, while unapproved extensions and detected external file modifications were excluded or explicitly marked.

This raises the cost of fully automated coding agents, but still does not prove that the developer received no off-device AI assistance.

### 3.3 Explicit non-claims

The receipt must never state any of the following without a substantially stronger mechanism:

- “100% written by a human”
- “AI-free”
- “no AI was consulted”
- “all ideas originated from the developer”
- “no second device was used”

These statements are not observable from a VS Code extension alone.

---

## 4. Assurance levels

The application defines a separate coding-provenance assurance level. This is reported alongside the project's U/P/E/C evidence instead of replacing it.

| Level | Name | Evidence |
| --- | --- | --- |
| C0 | Final artifact only | Only the submitted workspace hash is known. |
| C1 | Recorded session | Baseline, ordered edit events, final workspace root, and signed/hash-chained transcript are available. |
| C2 | Origin-aware session | External writes, unexplained file replacement, and bulk/unattributed changes are detected and marked. |
| C3 | Controlled editor | Session runs in an isolated VS Code environment with a declared extension set and companion file watcher. |
| C4 | Presence-bound controlled editor | C3 plus randomized human-presence challenges and a session-bound identity/authentication credential. |

A verifier can then express policy explicitly, for example:

~~~text
coding_provenance >= C3
presence >= P2
endpoint_integrity >= E2
~~~

Passing this policy means the listed evidence exists. It does not silently upgrade the result to a cognitive-authorship claim.

---

## 5. Threat model

The application should be designed against the following attacks.

### T0 — Forged session

An attacker generates a fake history after the code has already been produced.

**Mitigation:** server nonce, session-bound key, append-only event chain, timestamps, and signed final receipt.

### T1 — Import completed code after session start

The developer begins a session and then copies an already completed project into the workspace.

**Mitigation:** workspace baseline root, continuous filesystem watcher, file-creation/change events, unexplained replacement detection, and provenance labels on newly introduced content.

### T2 — Paste AI-generated code

AI output is copied into the editor in a large block.

**Mitigation:** record edit granularity and insertion size; known paste operations may be marked when observable; suspicious bulk insertion can be surfaced as provenance metadata.

This is an **evidence signal**, not a complete security boundary. An extension must not assume that every large insertion is AI or that every small insertion is human-authored.

### T3 — AI coding extension

An AI extension edits the same document while the recorder is active.

**Mitigation:** Extension mode records the resulting editor mutations but cannot generally establish their cognitive origin. Controlled mode therefore starts VS Code with a dedicated user-data directory and dedicated extensions directory containing only an approved extension set.

### T4 — External process modifies files

A shell command, script, formatter, code generator, agent, or another editor writes directly to the workspace.

**Mitigation:** companion daemon watches filesystem state and compares it with editor-observed mutations. Unmatched changes are classified as external or unattributed.

Legitimate generators should be represented explicitly rather than silently treated as human work.

### T5 — Realtime autonomous coding agent

An agent controls the editor directly and generates many ordinary-looking small edits.

**Mitigation:** session-private presence challenges, controlled endpoint, timing/audit experiments, and cost-based adversarial benchmarking. Keystroke-like behavior must not by itself be treated as proof of humanity.

### T6 — Human relay from an off-device AI

A human reads AI output from a phone or second computer and manually types it.

**Mitigation:** no reliable mitigation in the base design. This is a fundamental limitation and must be included in the receipt semantics and research evaluation.

### T7 — Recorder bypass / malicious endpoint

The user modifies the extension, VS Code, daemon, or OS and submits fabricated events.

**Mitigation:** signed release artifacts, device-bound/session-bound keys, executable integrity checks where available, and eventually platform attestation. A normal VS Code extension alone cannot defend strongly against a hostile local administrator.

---

## 6. Architecture

The recommended design has four components.

~~~text
+-------------------------+
| Verification Service    |
| - session nonce         |
| - challenge engine      |
| - receipt issuer        |
+-----------+-------------+
            |
            | WebSocket / HTTPS
            |
+-----------v-------------+
| Local Session Agent     |
| - session key           |
| - filesystem watcher    |
| - event hash chain      |
| - VS Code launcher      |
+-----------+-------------+
            |
            | local IPC
            |
+-----------v-------------+
| VS Code Extension       |
| - document events       |
| - save/open/close state |
| - user-facing status    |
| - presence prompts      |
+-----------+-------------+
            |
+-----------v-------------+
| Workspace               |
| source files / git tree |
+-------------------------+
~~~

### 6.1 VS Code extension

The extension is responsible for editor-visible state:

- session start/stop UI;
- active workspace identity;
- text-document change events;
- open/save/close events;
- current document hashes;
- explicit commands invoked through the PoHW extension;
- challenge UI;
- status bar showing verified / degraded / invalid session state.

VS Code exposes document-change events suitable for recording document mutations. These events should be treated as **editor-observed changes**, not proof that the change originated from a physical keystroke.

### 6.2 Local session agent

A separate local process is preferable to putting the trust boundary entirely inside the extension host.

Responsibilities:

- generate or hold the ephemeral session signing key;
- start an isolated VS Code instance in Controlled mode;
- watch filesystem changes independently of the extension;
- correlate VS Code document events with on-disk mutations;
- maintain append-only transcript state;
- communicate with the verification service;
- finalize workspace and transcript roots.

This separation also gives the project a path toward native code signing and platform attestation later.

### 6.3 Verification service

Responsibilities:

- issue fresh session nonce;
- commit to challenge schedule;
- receive chained events or commitments;
- issue unpredictable presence challenges when policy requires them;
- finalize receipt;
- sign receipt with verifier key.

### 6.4 Standalone verifier

The verifier consumes:

- receipt;
- declared policy;
- optional event transcript;
- optional workspace baseline/final tree.

It should be possible to verify receipt integrity without trusting the original UI.

---

## 7. Controlled VS Code session

A plain extension is useful for provenance collection but is a weak security boundary because other extensions and local programs may also modify code.

The stronger mode launches a dedicated VS Code instance using isolated storage:

~~~text
code <workspace> \
  --user-data-dir <session-user-data> \
  --extensions-dir <approved-extensions>
~~~

The session agent prepares the approved extension directory before launch. The directory should contain only the PoHW extension and explicitly permitted development extensions.

The session manifest records:

~~~json
{
  "editor": "vscode",
  "editor_version": "...",
  "pohw_extension_version": "...",
  "approved_extensions": [
    {"id": "...", "version": "...", "sha256": "..."}
  ],
  "workspace_baseline": "sha256:...",
  "policy_id": "coding-exam-v1"
}
~~~

This mode materially improves the statement “the monitored editor environment was constrained,” but it still does not prevent second-device relay.

---

## 8. Event model

Each session event participates in a hash chain:

\[
H_i = H(H_{i-1} \parallel canonical(event_i))
\]

Suggested event envelope:

~~~json
{
  "session_id": "...",
  "seq": 142,
  "event_type": "document_change",
  "monotonic_time_ms": 381994,
  "path_commitment": "sha256:...",
  "before_hash": "sha256:...",
  "after_hash": "sha256:...",
  "change": {
    "range_start": 811,
    "range_length": 4,
    "inserted_length": 11,
    "inserted_text_hash": "sha256:..."
  },
  "origin": "editor_observed",
  "previous_event_hash": "sha256:..."
}
~~~

The default server-side transcript does not need to upload source code. It can store:

- path commitments;
- before/after document hashes;
- inserted-text hashes;
- insertion/deletion lengths;
- timing metadata;
- event root.

A higher-assurance policy may additionally retain encrypted patches so an authorized verifier can replay the entire edit history.

---

## 9. Provenance map

A useful application-specific feature is a provenance map for the final source tree.

Each final span can carry a coarse label:

- **baseline** — existed before the verified session;
- **editor-observed** — introduced through an observed editor mutation;
- **external** — changed on disk without a matching editor event;
- **tool-generated** — generated by an explicitly declared formatter/compiler/generator;
- **unattributed** — origin could not be established.

Example summary:

~~~json
{
  "final_code_bytes": 18420,
  "baseline_bytes": 7210,
  "editor_observed_bytes": 10380,
  "declared_tool_bytes": 610,
  "external_or_unattributed_bytes": 220
}
~~~

This is more useful than a binary “human / AI” label because a verifier can reject, tolerate, or manually inspect unverified regions according to policy.

The provenance algorithm must handle edits as interval transformations so that insertions, deletions, replacements, formatting, and file moves preserve or deliberately replace labels.

---

## 10. Paste and typing semantics

The prototype should avoid making “typing speed” or “keystroke pattern” the primary proof.

Reasons:

1. VS Code document-change events represent content mutation, not necessarily raw physical input.
2. other extensions can produce similar mutations;
3. an autonomous agent can imitate realistic timing;
4. a human can retype AI output manually;
5. behavioral biometrics introduce privacy and accessibility problems.

The first version should therefore record quantitative edit features only as audit metadata:

- inserted characters per event;
- event burst size;
- replacement size;
- idle time;
- external-change correlation;
- document-switch sequence.

A later experiment may test whether such signals increase attack cost, but they should never become an opaque “human score.”

---

## 11. Presence challenges for coding

Presence checks should interfere minimally with normal development.

Possible session-private challenges include:

### 11.1 Context-bound acknowledgement

At an unpredictable point, ask the developer to select or identify a recently edited symbol or region whose challenge is derived from private session history.

### 11.2 Local-state confirmation

Ask a small question whose answer depends on the current private workspace state, such as choosing which of several recently edited functions contains a session-specific marker.

### 11.3 Short-lived interaction challenge

Require a response within the editor to a nonce-bound prompt that expires quickly and becomes part of the transcript.

These are intended to establish continued participation and increase relay cost. They are not programming tests and should not be designed around “AI cannot answer this.”

For higher-risk settings, liveness may be added as a separate P-evidence mechanism, but it should remain independent from code provenance.

---

## 12. Session lifecycle

### Start

1. user runs “Start Verifiable Coding Session”;
2. agent requests server nonce and policy;
3. session key is created/bound;
4. current Git commit and dirty workspace are canonicalized;
5. baseline workspace root is computed;
6. Controlled mode validates editor/extension manifest;
7. recording begins.

### During session

1. VS Code extension emits editor events;
2. agent correlates them with filesystem events;
3. every event extends the hash chain;
4. server occasionally provides fresh challenge material;
5. external/unattributed changes downgrade the affected provenance region or session state;
6. user can continuously see assurance status.

### Finalize

1. all buffers are saved or explicitly excluded;
2. final workspace root is computed;
3. final provenance map is summarized;
4. transcript root is finalized;
5. server checks challenge/presence evidence;
6. server issues signed Coding Session Receipt.

---

## 13. Coding Session Receipt

Example:

~~~json
{
  "version": "pohw-coding-receipt/0.1",
  "session_id": "...",
  "started_at": "...",
  "ended_at": "...",
  "workspace": {
    "baseline_root": "sha256:...",
    "final_root": "sha256:..."
  },
  "coding_provenance": {
    "level": "C3",
    "editor_observed_bytes": 10380,
    "external_or_unattributed_bytes": 0,
    "controlled_editor": true
  },
  "evidence": {
    "uniqueness": {"level": 0},
    "presence": {"level": 2},
    "endpoint_integrity": {"level": 2},
    "contribution": {"level": 0}
  },
  "transcript_root": "sha256:...",
  "policy": "coding-session-v1",
  "issuer": "...",
  "signature": "..."
}
~~~

A UI may display:

~~~text
Verifiable Coding Session

Coding provenance       C3  Controlled editor
Presence                P2  Session-private challenges
Endpoint integrity      E2  Bound local session agent

Workspace baseline      sha256:...
Final workspace         sha256:...
Unattributed changes    0 bytes
Receipt                 valid
~~~

It should not display “Verified Human Code” as an unconditional boolean.

---

## 14. Verification policy examples

### Open-source contribution provenance

~~~text
require coding_provenance >= C1
allow baseline code
allow declared formatters
external changes <= 5%
~~~

### Controlled coding examination

~~~text
require coding_provenance >= C3
require presence >= P2
require endpoint_integrity >= E2
external_or_unattributed_bytes == 0
approved_extensions == exam_allowlist
~~~

### Human-work research dataset

~~~text
require coding_provenance >= C4
require complete transcript
require external_or_unattributed_bytes == 0
exclude sessions with undeclared generators
retain raw timing only with participant consent
~~~

---

## 15. Prototype plan

### M0 — Provenance-only VS Code extension

Implement:

- start/stop session;
- workspace baseline and final roots;
- text-document change capture;
- per-document rolling hashes;
- append-only event chain;
- local receipt export.

Goal: prove that a final workspace can be cryptographically bound to a recorded sequence of editor-observed mutations.

### M1 — Local agent and filesystem reconciliation

Implement:

- companion daemon;
- file watcher;
- editor-event / disk-event correlation;
- external-change detection;
- provenance summary.

Goal: identify modifications that bypass the editor event stream.

### M2 — Controlled VS Code launcher

Implement:

- isolated user-data directory;
- isolated extensions directory;
- extension manifest;
- version/hash recording;
- policy validation before session start.

Goal: materially reduce unobserved AI-extension and extension-host attack surface.

### M3 — Presence integration

Reuse PoHP session infrastructure:

- server nonce;
- PIH challenge scheduling;
- session-bound presence challenges;
- signed server receipt.

Goal: bind recorded coding activity to continued human participation.

### M4 — Adversarial benchmark

Test at least:

1. honest human coding;
2. bulk paste from an LLM;
3. AI coding extension;
4. external agent writing files;
5. autonomous GUI agent;
6. human reading AI output on a second device.

Measure:

- attack success rate;
- honest-user friction;
- false reject rate;
- time overhead;
- detectable unattributed changes;
- attacker operator time;
- model/API cost;
- assurance downgrade frequency.

The most important expected result is not perfect prevention. It is a precise map of which attack classes each assurance level can and cannot distinguish.

---

## 16. Recommended first implementation boundary

The first prototype should **not** attempt keystroke biometrics, webcam surveillance, AI-code classifiers, or OS-level anti-cheat.

The smallest useful implementation is:

~~~text
VS Code extension
    + session nonce
    + workspace baseline hash
    + document mutation hash chain
    + filesystem watcher
    + final workspace root
    + signed receipt
~~~

This can already answer a meaningful question:

> “Did this submitted code emerge from the declared baseline through this recorded editing session, or was part of it introduced through an unobserved path?”

Once that is measurable, the project can experimentally determine whether Controlled mode and presence challenges add enough security value to justify their friction.

---

## 17. Relationship to PoHP

This application maps naturally onto the existing evidence model:

| PoHP dimension | Coding-session interpretation |
| --- | --- |
| U — Uniqueness | Which authenticated person/credential is associated with the session? |
| P — Presence | Was that person continuously or repeatedly present while coding? |
| E — Endpoint Integrity | Did evidence come from the expected VS Code/session-agent environment? |
| C — Contribution | Did the submitted code or task satisfy the required quality/usefulness criteria? |

Coding provenance is an additional domain-specific dimension describing **how the artifact evolved**. It should remain independent from contribution quality and human identity.

This separation lets the project issue precise receipts instead of claiming an unobservable property.

---

## References

- Visual Studio Code Extension API, Workspace document-change events: https://code.visualstudio.com/api/references/vscode-api
- Visual Studio Code CLI, isolated user data and extensions directories: https://code.visualstudio.com/docs/configure/command-line
- Visual Studio Code extension command-line management: https://code.visualstudio.com/docs/configure/extensions/extension-marketplace
