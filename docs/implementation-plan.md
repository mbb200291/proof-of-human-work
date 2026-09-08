# Proof of Human Work：階段性實作計畫

> 目標：從研究假說推進到可被紅隊測試、可量測攻擊成本的 PoHP prototype。  
> 原則：每一階段只新增一個主要安全假設，先驗證效果，再決定是否保留。

## 1. 實作目標

第一版系統不以「AI 無法通過」作為成功條件，也不嘗試直接證明「認知工作百分之百由人腦完成」。

Prototype 要回答的是：

> 能否透過不可預測、依賴 session 私有狀態的互動，加上可驗證的工作紀錄與漸進式 assurance，使 AI 代理成功完成工作的總成本顯著高於誠實人類？

核心量測：

\[
\rho = \frac{C_{successful\ AI\ proxy}}{C_{honest\ human\ completion}}
\]

初期研究目標：

- 一般工作：\(\rho \ge 3\)
- 有直接經濟獎勵的工作：朝 \(\rho \ge 10\) 驗證

這些值是工程目標，不是標準；實驗結果可以推翻或重新校正它們。

---

## 2. 第一版系統邊界

### 第一版要做

- 可驗證 session
- server-generated unpredictable challenge
- Private Interaction History（PIH）
- append-only / hash-chained interaction transcript
- contribution audit
- PoHP Receipt
- verifier policy
- adversarial benchmark harness
- honest human / AI agent / human+AI 的對照實驗

### 第一版先不做

- 虹膜或臉部唯一性資料庫
- 全球 Proof of Personhood
- blockchain / token / cryptocurrency
- 持續攝影機監控
- behavioral biometric identity model
- zero-knowledge proof
- 跨平台硬體 attestation 全套支援
- 通用 Human Work Unit

這些功能只有在前一層實驗證明有價值後才進入後續階段。

---

# Phase 0 — Protocol Baseline 與 Threat Model

## 目標

把「要證明什麼」變成 machine-readable policy，避免後面出現 `verified_human=true` 這類無法解釋的結果。

## 工作項目

### 0.1 定義 evidence model

固定四個維度：

```text
U - Uniqueness
P - Presence
E - Endpoint Integrity
C - Contribution
```

每個維度定義：

- level 0–4
- evidence mechanism
- issuer
- timestamp
- expiration
- verifier policy

### 0.2 定義 threat taxonomy

至少涵蓋：

```text
T0 replay / forged transcript
T1 automated bot
T2 realtime AI agent
T3 human + AI relay
T4 account rental / Sybil farm
```

### 0.3 定義 benchmark metrics

最少收集：

- task completion rate
- attack success rate
- human false reject rate
- median completion time
- challenge overhead
- inference/API cost
- operator time
- end-to-end relay latency
- failed-session cost
- contribution quality
- rho attack-cost ratio

## 產出

```text
spec/
  evidence-model.md
  threat-model.md
  metrics.md
```

## Exit Criteria

- 任一 receipt claim 都可以映射回 U/P/E/C。
- T0–T4 都有可重現 attack scenario。
- 不存在未定義意義的 `human_score` 或 `verified_human`。

---

# Phase 1 — Minimal Verifiable Session

## 目標

先解決 T0：證明 session transcript 沒有被事後任意偽造或重播。

## 建議技術

初期可使用：

- Go backend
- REST / WebSocket
- browser client
- SHA-256
- Ed25519 / WebCrypto signing key
- SQLite 或 PostgreSQL

WebAuthn 可在此階段後半加入，但不必阻塞最小 prototype。

## Session model

```text
POST /sessions
    -> server_nonce
    -> session_id
    -> challenge_seed_commitment

client creates session key

POST /sessions/{id}/events
    event_n = {
        seq,
        previous_hash,
        challenge_id,
        response_commitment,
        client_timestamp,
        signature
    }

POST /sessions/{id}/finalize
    -> transcript_root
    -> server signed receipt
```

## Hash chain

\[
H_i = H(H_{i-1} || canonical(event_i))
\]

至少保證：

- sequence 不可任意插入／刪除
- event 修改會破壞 root
- receipt 可重新驗證

## PoHP Receipt v0.1

```json
{
  "version": "pohp-receipt/0.1",
  "session_id": "...",
  "subject": "...",
  "started_at": "...",
  "ended_at": "...",
  "transcript_root": "sha256:...",
  "evidence": {
    "uniqueness": {"level": 0},
    "presence": {"level": 0},
    "endpoint_integrity": {"level": 1},
    "contribution": {"level": 0}
  },
  "issuer": "...",
  "signature": "..."
}
```

## 產出

```text
cmd/server/
internal/session/
internal/receipt/
internal/crypto/
web/
spec/receipt-schema.json
```

## Exit Criteria

- replayed nonce 被拒絕。
- 修改任一 event 後 receipt verification 失敗。
- 同一 transcript 可以由獨立 verifier 重算 root。
- 可以建立、完成並驗證至少 100 個自動測試 session。

---

# Phase 2 — Private Interaction History（PIH）

## 目標

開始處理 T1/T2：把「批次抓題 → 離線丟 LLM → 批次提交」轉換成必須即時跟隨 session 的攻擊。

## Challenge Engine

每個 challenge 由以下資訊產生：

\[
Q_i = F(S, H_{i-1}, R_i, task\_state_i)
\]

其中：

- \(S\)：session secret / server seed
- \(H_{i-1}\)：目前 transcript root
- \(R_i\)：fresh server randomness
- `task_state_i`：前序工作狀態

### 必備機制

#### Adaptive branch

下一題依賴上一題答案或操作結果。

#### Commit-before-reveal

使用者先提交 response commitment，某些 audit 資訊之後才 reveal，降低攻擊者等待更多 context 後回頭修改答案的能力。

#### Delayed cross-probe

稍後隨機詢問與較早 interaction 有關、但不是單純記憶測驗的交叉問題。

#### Random audit

不是每一題都 audit，避免固定模式被 agent 特化。

## MVP task family

第一版不要追求「AI 做不到」的題型，選擇容易量測 contribution 的工作。

建議先做：

### Pairwise judgment with mutable context

```text
A vs B -> choice
choice modifies later candidate set
later audit probes relationship among prior choices
```

### Structured review

```text
inspect artifact
-> mark issue
-> later receive modified artifact
-> judge whether issue resolved
```

這兩類 task 容易同時得到：

- work output
- information gain
- cross-check
- delayed probe

## 產出

```text
internal/challenge/
internal/pih/
internal/task/
spec/pih-protocol.md
```

## Exit Criteria

- challenge 不可在 session 開始時全部預先取得。
- 刪除中間 event 會使後續 challenge 無法重現。
- naive batch LLM attack 明顯失敗或必須改造成 realtime relay。
- human median overhead 控制在基準工作時間的 +25% 以內。

若 PIH 需要超過 +50% 人類時間才能產生效果，必須重新設計，不應直接把高摩擦當成安全性。

---

# Phase 3 — Contribution Audit 與 Adversarial Benchmark

## 目標

這一階段是整個專案的第一個真正判定點：確認 PIH 是否只是比較麻煩的 CAPTCHA，還是真的提高 AI proxy 成本。

## 3.1 Contribution Score

Prototype 採可解釋分數：

\[
C = w_gG + w_rR + w_iI + w_pP_q
\]

其中：

- `G` — gold task accuracy
- `R` — retest / task-specific consistency
- `I` — information gain
- `Pq` — peer / downstream quality

分數必須與 evidence 分開：

```text
presence != contribution
contribution != humanness
```

## 3.2 攻擊者實作

至少建立五種 runner：

```text
benchmark/runners/
  honest-human/
  batch-llm/
  realtime-llm/
  browser-agent/
  human-ai-copilot/
```

### A — Batch LLM

一次取得可見資料後離線生成。

### B — Realtime LLM relay

每個 challenge 即時呼叫模型 API。

### C — Browser agent

直接讀 DOM / screenshot，控制瀏覽器完成 session。

### D — Human + AI copilot

真人處理登入與需要人的步驟，AI 處理主要判斷。

這個 runner 對 T3 最重要。

## 3.3 成本模型

攻擊成本至少包含：

```text
model_cost
+ compute_cost
+ human_operator_seconds
+ automation_setup_amortization
+ failed_session_expected_loss
+ credential_cost
```

誠實人類成本：

```text
human_active_seconds * reference_hourly_cost
+ friction_penalty
```

## 3.4 實驗矩陣

| Variant | PIH | Audit | Deadline | Human | Batch LLM | Realtime LLM | Browser Agent | Human+AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V0 | no | no | no | test | test | test | test | test |
| V1 | yes | no | no | test | test | test | test | test |
| V2 | yes | yes | no | test | test | test | test | test |
| V3 | yes | yes | adaptive | test | test | test | test | test |

## Exit Criteria — Gate 1

至少達成以下其中一個結果才值得繼續：

### Success

- \(\rho \ge 3\) 且 human false reject < 5%
- human overhead < 25%
- contribution quality 不低於 baseline

### Partial success

- AI success rate 沒大幅下降，但 AI latency / operator / inference cost 顯著上升
- 有清楚可最佳化的瓶頸

### Failure

若 realtime agent 與 human+AI 在幾乎零額外成本下穩定通過，應記錄「PIH 單獨不足」，而不是繼續增加任意 challenge 難度。

---

# Phase 4 — WebAuthn 與 Endpoint Integrity

## 前置條件

只有 Gate 1 顯示 PIH 有一定效果，才進入這一階段。

## 目標

處理：

- credential replay
- transcript forgery
- 大量廉價 server-side bot
- 未授權 client

並測量可信 endpoint 對 T2/T3 的實際增益。

## 4.1 WebAuthn

導入：

- registration
- authentication
- user verification
- session binding

注意：同步 passkey 不等於 device-bound credential，不能因為使用 WebAuthn 就宣稱「固定硬體參與」。

## 4.2 Native attestation experiment

先選一個平台，不同時做全部：

**建議優先順序：**

1. Android Play Integrity / Key Attestation
2. Apple App Attest
3. desktop TPM

選 Android 的理由是較容易取得明確的 integrity verdict 與 hardware-backed evidence 做研究比較。

## Experiment

比較：

```text
browser only
vs
WebAuthn
vs
native attested client
```

測量：

- bot deployment cost
- remote relay feasibility
- device farm cost
- normal user friction

## Exit Criteria — Gate 2

Endpoint attestation 至少要在以下某一項產生顯著增益：

- 攻擊開發成本
- credential acquisition cost
- parallel attack scalability
- transcript integrity

若只增加 client 複雜度而沒有可量測安全增益，不納入預設 protocol。

---

# Phase 5 — Risk-based Presence Step-up

## 前置條件

只針對具有明顯經濟誘因、且 T3 human+AI relay 已成主要攻擊來源的場景。

## 目標

實驗「不定期真人 presence」是否真的提高 T3 relay 成本。

## Variant

```text
P0: no liveness
P1: session-start liveness
P2: one random liveness
P3: risk-triggered liveness
P4: random + continuity
```

## 原則

- 不持續錄影。
- raw biometric 不進 receipt。
- 優先保存 provider verdict / proof metadata。
- 明確 retention policy。
- liveness 是 Presence evidence，不得轉譯成 Cognitive Work proof。

## Metrics

- T3 attack cost
- liveness completion rate
- false reject
- abandonment
- accessibility impact
- per-session monetary cost
- privacy perception survey

## Exit Criteria — Gate 3

若 random liveness 對 T3 成本提升小於 2×，但顯著增加使用者流失或隱私成本，預設不採用。

---

# Phase 6 — Personhood / Sybil Resistance（Optional）

## 前置條件

只有產品需求真的出現：

```text
one human -> one credential / one reward / one vote
```

才需要進入此階段。

## 候選路線

### Social graph

- vouch budget
- cross-community witness
- edge aging
- reputation / slashing

### Existing personhood provider

研究整合現有 credential，而不是自行建立 biometric enrollment infrastructure。

### Biometric uniqueness

僅在高價值且無替代方案時研究。

## 重要邊界

Personhood 解決：

```text
U - Uniqueness
```

它不能取代：

```text
P - Presence
E - Endpoint Integrity
C - Contribution
```

## Exit Criteria

在導入任何 biometric enrollment 前，必須先有：

- 明確的 Sybil economic model
- 為什麼 social / economic alternative 不足的分析
- privacy impact assessment
- data retention / deletion policy
- false positive / false negative handling
- credential revocation / recovery design

---

# Phase 7 — Privacy-preserving Receipt（Research Track）

這一階段不是 MVP 必要條件，但若 PoHP receipt 要跨服務流通，就需要處理 unlinkability 與 selective disclosure。

## 研究方向

- Merkle selective disclosure
- anonymous credential
- nullifier
- zero-knowledge proof of policy satisfaction

例如 verifier 只需要知道：

```text
presence >= 2
endpoint >= 2
contribution >= 0.75
```

而不必取得：

- 原始 transcript
- 使用者身份
- 所有 challenge 細節

這可以演進為：

```text
prove(policy(receipt) == true)
without revealing full receipt
```

---

# 3. 建議 Repository 結構

Prototype 開始後建議演進為：

```text
.
├── README.md
├── docs/
│   ├── research/
│   │   └── proof-of-human-participation.md
│   └── implementation-plan.md
├── spec/
│   ├── evidence-model.md
│   ├── threat-model.md
│   ├── metrics.md
│   ├── pih-protocol.md
│   └── receipt-schema.json
├── cmd/
│   ├── server/
│   └── verifier/
├── internal/
│   ├── session/
│   ├── challenge/
│   ├── pih/
│   ├── receipt/
│   ├── crypto/
│   └── task/
├── web/
├── benchmark/
│   ├── scenarios/
│   ├── runners/
│   └── results/
└── experiments/
    └── README.md
```

---

# 4. 第一個可工作的 End-to-End Demo

第一個 demo 應該非常小：

```text
1. User starts session
2. Server returns nonce
3. Client creates/binds signing key
4. Server emits adaptive PIH task
5. User completes 10–20 work events
6. Server inserts 2–3 random audit probes
7. Every event joins hash chain
8. Contribution score is computed
9. Server issues signed PoHP receipt
10. Independent verifier checks receipt
```

Demo UI 顯示：

```text
Session completed

Uniqueness          L0
Presence            L2  [PIH, cross-probe]
Endpoint Integrity  L1  [signed session]
Contribution        L2  [audit score 0.84]

Transcript Root     sha256:...
Receipt             valid
```

避免顯示：

```text
100% HUMAN
AI FREE
VERIFIED HUMAN WORK
```

因為第一版沒有能力支持這些 claim。

---

# 5. 實驗優先順序

這個專案的價值主要來自實驗結果，而不是 protocol 複雜度。建議優先順序：

1. **先證明 transcript 可驗證。**
2. **再證明 PIH 能破壞 batch automation。**
3. **再測 realtime AI relay。**
4. **再測最重要的 human + AI relay。**
5. **只有攻擊仍有足夠經濟誘因時才加入 endpoint attestation。**
6. **只有 T3 仍是主要瓶頸時才加入 liveness。**
7. **只有出現一人一份權利需求時才研究 personhood。**

整個 roadmap 的核心判斷原則：

> **每增加一層使用者摩擦、硬體依賴或隱私成本，都必須能用 adversarial experiment 證明它增加了多少攻擊成本。**

---

# 6. 第一輪 Milestone

## M0 — Specification

完成：

- evidence model
- threat model
- metrics
- receipt schema

**完成定義：** 可以只看 spec 就實作 verifier。

## M1 — Verifiable Session

完成：

- session API
- nonce
- event hash chain
- signed receipt
- standalone verifier

**完成定義：** transcript 被修改後 verifier 必定拒絕。

## M2 — PIH Engine

完成：

- adaptive challenge
- delayed cross-probe
- audit scheduling
- sample task

**完成定義：** challenge 必須依賴前序 session state，無法在 session 開始時全部預取。

## M3 — Attack Benchmark

完成：

- batch LLM runner
- realtime LLM runner
- browser agent runner
- human baseline
- human+AI protocol

**完成定義：** 可以產出同一 task variant 的 cost / success comparison table。

## M4 — Gate 1 Report

輸出：

```text
experiments/gate-1-pih.md
```

回答：

- PIH 是否有效？
- 對哪類 attacker 有效？
- \(\rho\) 實測是多少？
- human friction 是多少？
- 下一步是否值得加入 hardware assurance？

Gate 1 應被視為第一個真正的研究里程碑。若結果是否定的，也是一個有價值的專案結果。

---

# 7. 目前推薦的開發順序

```text
Phase 0  Protocol specification
   |
   v
Phase 1  Verifiable session / receipt
   |
   v
Phase 2  PIH challenge engine
   |
   v
Phase 3  Adversarial benchmark
   |
   +---- Gate 1: PIH has measurable value? ---- no ---> redesign / publish negative result
   |
  yes
   v
Phase 4  Endpoint integrity
   |
   +---- Gate 2: measurable security gain? ---- no ---> keep web-only path
   |
  yes / high-risk use case
   v
Phase 5  Presence step-up
   |
   +---- Gate 3: T3 cost gain worth privacy? --- no ---> remove liveness default
   |
  yes
   v
Phase 6  Personhood only when uniqueness is required
   |
   v
Phase 7  Privacy-preserving portable receipts
```

這個順序刻意把昂貴、具隱私成本、容易造成產品綁定的技術放在後面；先用最少假設驗證 PoHW 的核心研究問題。
