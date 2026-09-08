# Proof of Human Participation（PoHP）設計研究

> 研究日期：2026-09-07  
> 專案：Proof of Human Work  
> 狀態：Research baseline / 可供 prototype 設計使用

## 1. 研究問題

本研究試圖回答一個比 CAPTCHA 更嚴格的問題：

> 在 AI 與代理程式可以完成大量純數位認知工作的前提下，能否建立一套機制，合理證明「某個真實且盡可能唯一的人類，在一段時間內確實投入不可忽略的參與／工作量，並產生可驗證貢獻」？

這裡的重點不是單次「真人判定」，也不是宣稱可以從輸出內容辨認是否使用 AI，而是建立一組可被 verifier 明確理解的 **assurance evidence**。

研究涵蓋：

- Proof of Personhood / Sybil resistance
- WebAuthn、device-bound credential、硬體 attestation
- liveness / presentation attack detection
- behavioral continuity
- CAPTCHA 與 AI automation 的限制
- crowdsourcing quality control、gold task、peer validation、peer prediction
- Private Interaction History（PIH）與不可預測 session
- 社交圖譜與多人背書
- biometric uniqueness
- 攻擊經濟與分級 assurance

---

## 2. 最重要的理論界線

### 2.1 純 challenge-response 無法直接證明「人腦完成」

若 verifier 只能看到：

```text
challenge -> response
```

而人類與 AI 都可以取得相同 challenge、使用相同數位通道送出 response，則 verifier 無法直接觀察中間究竟是：

```text
challenge -> human cognition -> response
```

或：

```text
challenge -> AI cognition -> response
```

甚至：

```text
challenge -> AI -> human operator -> response
```

因此，「某種題目目前 AI 很難解」最多只是暫時的能力差距，不是穩定的安全根。偏好排序、圖像辨識、邏輯題、文字生成、多輪一致性、刻意加入猶豫或錯誤，都可以被模型模擬。

CAPTCHA 與 facial-liveness 的攻防文獻也反覆呈現相同現象：一旦安全性依賴「機器目前不擅長某種認知或感知任務」，能力進步會持續移動攻防邊界。[Li et al., 2022](https://arxiv.org/abs/2202.10673)

### 2.2 因此 PoHW 應改寫成 assurance composition

本研究建議把 Proof of Human Work 的可實作核心定義為：

> **Proof of Human Participation（PoHP）**：證明一組與真人唯一性、持續參與、工作通道完整性與有效貢獻相關的證據，而不是宣稱「AI 不曾介入」。

使用四維 assurance vector：

\[
PoHP = (U, P, E, C)
\]

| 維度 | 名稱 | 要回答的問題 |
| --- | --- | --- |
| **U** | Uniqueness | 此 credential 是否盡可能對應到一個唯一真人？ |
| **P** | Presence | 真人是否在指定工作期間持續參與？ |
| **E** | Endpoint Integrity | 互動紀錄是否來自可信裝置／應用程式，且未被事後偽造？ |
| **C** | Contribution | 工作是否提供具有品質與資訊價值的貢獻？ |

這四者不應壓縮成模糊的 `verified_human=true`。一份 receipt 應該明確揭露各維度 assurance level 與所使用的證據。

---

## 3. 威脅模型

PoHP 必須把「真人協助 AI」列為一級威脅，而不是只防 bot。

### T0 — Replay / fabricated transcript

攻擊者重播舊 session、偽造 timestamp、修改工作紀錄，或事後生成整份 transcript。

**主要防禦：** server nonce、hash chain、Merkle root、簽章、session key、短效 challenge。

### T1 — Automated bot

完全由程式自動執行工作，沒有真人參與。

**主要防禦：** WebAuthn user verification、裝置綁定、PIH、不可預測 challenge、risk-based presence check。

### T2 — Remote AI agent

AI 代理即時讀取任務並回覆，維持 session 狀態。

**主要防禦：** 不能依賴題目難度；需要 PIH、可信 endpoint、隨機抽查與成本放大。

### T3 — Human + AI relay

真人負責登入、passkey、face liveness；AI 負責主要認知工作。這是最重要也最難處理的攻擊。

**主要防禦：** 沒有單一技術能完全解決。只能透過持續 presence、不可預測的 session-private context、可信 endpoint、工作抽查、重新詢問與整批失效機制提高 relay 成本。

### T4 — Account rental / Sybil farm

大量真人出租帳號、執行 liveness、代按認證，或攻擊者取得大量低成本「真人身份」。

**主要防禦：** Proof of Personhood、credential 稀缺性、social graph、biometric uniqueness、rate limit、reputation、stake/slashing、跨 session 統計。

---

## 4. 五類可行方案

## 4.1 方案 A：Hardware-backed Attested Session

### 核心概念

使用不可匯出的硬體私鑰、WebAuthn/device-bound credential 與裝置 attestation，把工作 session 綁到一個可驗證 endpoint。

可能元件：

- WebAuthn / FIDO credential
- TPM / Secure Enclave / StrongBox
- Android Key Attestation / Play Integrity
- Apple App Attest
- server nonce
- session signing key
- append-only interaction log

W3C WebAuthn 定義 public-key credential、簽章與 attestation；Android Key Attestation 可提高「金鑰位於 hardware-backed keystore」的信心；FIDO 也區分可同步與 device-bound passkey。[W3C](https://www.w3.org/2026/08/wg-webauthn-charter.html) [FIDO Alliance](https://fidoalliance.org/passkeys/) [Android](https://developer.android.com/privacy-and-security/security-key-attestation)

### Protocol sketch

```text
server -> nonce
client -> create/bind session key
client -> attestation + signed nonce
server -> verify endpoint policy

for each work event:
    event_i = H(event_{i-1}) || payload || timestamp || server_challenge
    client signs event_i

session end:
    receipt = Sign_server(session_root, policy, metrics)
```

### 可以證明

- 某個 credential / device 確實參與 session。
- transcript 較難被事後任意改寫。
- 可將 session 綁定到特定應用程式或硬體安全層級。

### 不能證明

- 裝置前的人一定是真人。
- 認知工作一定由人類完成。
- 真人沒有透過另一台裝置詢問 AI。

### 攻擊

- remote desktop / accessibility automation
- 真人登入後把工作交給 AI
- 裝置 farm
- compromised endpoint
- attestation bypass 或 root/jailbreak ecosystem

### 優缺點

**優點**

- transcript integrity 很強。
- 可大規模部署。
- 不一定需要生物資料。
- 很適合成為其他方案的基礎層。

**缺點**

- 對「人類認知」的直接證明很弱。
- Web 平台與原生 app 的 attestation 能力不一致。
- 會產生裝置相容性與供應商依賴。

### 適合 claim

- U：低～中
- P：低
- E：高
- C：無直接幫助

---

## 4.2 方案 B：Private Interaction History（PIH）

### 核心概念

讓工作 session 建立一段只有該 session 即時取得的私人互動歷史。下一步 challenge 依賴：

```text
server entropy
+ previous response
+ session state
+ short-lived context
```

產生不可預先大量抓取的 ephemeral stimulus。

重點不是讓 AI 「看不懂」，而是讓攻擊者必須即時跟完整 session、維護狀態並承擔 latency / API / context relay 成本。

### Protocol sketch

```text
S0 = random server seed

for i in 1..n:
    challenge_i = F(S0, transcript_root_{i-1}, random_i)
    client commits response_i
    server updates transcript root

randomly:
    ask delayed cross-probe about earlier session-private state
    request re-evaluation / consistency relation

session end:
    evaluate continuity + contribution + challenge coverage
```

可以加入：

- commit-before-reveal
- delayed cross-probe
- adaptive branching
- random short response deadline
- memory-dependent reference
- task-specific state mutation

### 可以證明

- 某個 agent 持續跟隨完整 session，而非離線批次產生答案。
- 提高「拿題庫 → 丟 LLM → 批次提交」的成本。
- 為工作量建立可驗證的時間序列。

### 不能證明

- 維持 session 的 agent 一定是人類。
- 即時 AI relay 無法完成。

### 攻擊

- browser automation + realtime multimodal agent
- full-session screen capture / DOM extraction
- local LLM
- human + AI co-pilot

### 優缺點

**優點**

- 不需要生物辨識。
- 可以直接整合進實際工作流程。
- 最適合做可量測 adversarial benchmark。
- 安全目標可以明確轉為「提高 AI 代理成本」。

**缺點**

- 強 AI 仍可完成。
- challenge 過多會降低 UX 與真實工作價值。
- 若設計不當，很容易退化成新型 CAPTCHA。

### 適合 claim

- U：無
- P：中
- E：中（若與簽章整合）
- C：中～高

---

## 4.3 方案 C：Liveness + Behavioral Continuity

### 核心概念

在 session 中不定期要求 liveness，並持續觀察與工作相關的行為 continuity，例如輸入節奏、指標操作、觸控模式、視線或攝影機訊號。

NIST SP 800-63A-4 對 biometric presentation attack detection（PAD）有明確要求，並要求測試符合 ISO/IEC 30107-3:2023；這表示正式 liveness 系統不能只以單張自拍作為高 assurance 證據。[NIST SP 800-63A-4](https://pages.nist.gov/800-63-4/sp800-63a.html)

### Protocol sketch

```text
session start -> strong liveness
work stream -> behavioral continuity
random intervals -> active / passive liveness
risk spike -> step-up challenge
session end -> continuity score + evidence receipt
```

### 可以證明

- 工作期間多個時間點有真人活體訊號存在。
- session continuity 與真人操作具有一定統計一致性。

### 不能證明

- AI 沒有提供答案。
- 真人不是只負責配合鏡頭與按鍵。

### 攻擊

- deepfake / injection attack
- camera replay
- virtual camera
- remote-controlled human farm
- AI cognition + human actuator

### 優缺點

**優點**

- 對 Presence 的證據最直接。
- 適合高獎勵、高風險 session。

**缺點**

- 隱私成本高。
- 無障礙與誤判問題顯著。
- 深偽與 presentation attack 是持續紅隊課題。
- 容易讓正常使用者感到被監控。

### 適合 claim

- U：低～中
- P：高
- E：中
- C：無直接幫助

---

## 4.4 方案 D：Social / Graph Personhood

### 核心概念

將 Sybil resistance 建立在「真實社會信任關係比建立虛假帳號更昂貴」的假設上。

SumUp、SybilGuard、SybilLimit 類研究的共同精神是：建立大量 node 很便宜，但要取得大量穿越 honest region 的可信 social edges 比較困難。SumUp 以 trust network 建立 Sybil-resilient voting。[USENIX: Sybil-Resilient Online Content Voting](https://www.usenix.org/legacyurl/sybil-resilient-online-content-voting)

Proof-of-Personhood 文獻也研究實體 pseudonym party、面對面 encounters 與一人一 credential 的可能性。[Ford, Proof-of-Personhood](https://arxiv.org/abs/2011.02412)

### Protocol sketch

```text
existing verified users
    -> limited vouch budget
    -> cross-community witness
    -> credential issuance
    -> edge aging / renewal
    -> fraud causes reputation loss / slashing
```

### 可以證明

- 攻擊者建立大量可信身份需要較多社會成本。
- 可以形成不依賴單一中央 KYC 的 personhood assurance。

### 不能證明

- 每個 social node 一定是真人。
- 某次工作確實由該真人完成。

### 攻擊

- collusion cluster
- bought accounts / rented humans
- coercion
- community capture
- 邊緣化使用者難取得足夠 vouch

### 優缺點

**優點**

- 對 Sybil resistance 有直接價值。
- 不一定需要中央身份資料庫或 biometric。

**缺點**

- 啟動困難。
- 社會結構偏差會直接變成制度偏差。
- 對單次工作 participation 幫助有限。

### 適合 claim

- U：中～高
- P：低
- E：低
- C：低

---

## 4.5 方案 E：Biometric PoP + Privacy-preserving Credential

### 核心概念

使用虹膜、臉部或其他 biometric 建立 uniqueness，再發行可匿名使用的 personhood credential，使後續工作驗證不必揭露原始 biometric。

World ID 是現有大規模案例之一：以專用 enrollment 硬體與虹膜相關流程建立 unique humanness，後續使用 credential 來證明 personhood。[World ID](https://world.org/world-id)

### Protocol sketch

```text
biometric enrollment
    -> uniqueness check
    -> issue anonymous / unlinkable credential

work session
    -> prove valid personhood credential
    -> optional nullifier prevents double use
    -> combine with P/E/C evidence
```

### 可以證明

- 在既定 biometric 系統與 enrollment 假設下，提供很強的一人一 credential assurance。

### 不能證明

- 這個人有持續參與工作。
- 認知工作由該人完成。

### 攻擊

- biometric spoof / deepfake
- enrollment corruption
- duplicate / false reject
- credential rental
- coercion
- biometric database compromise

### 優缺點

**優點**

- 對 U 維度最直接。
- 適合「一人只能領一次高價值權利」的場景。

**缺點**

- 隱私、治理、法規與社會接受成本最高。
- biometric 一旦外洩無法像密碼一樣更換。
- enrollment infrastructure 成本高。

### 適合 claim

- U：高
- P：低
- E：低～中
- C：無

---

## 5. 方案比較矩陣

評分僅表示相對工程評估，不代表既有標準認證。

| 方案 | U | P | E | C | 隱私成本 | 使用摩擦 | 硬體依賴 | 可擴展性 | 對 T3 Human+AI relay |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Hardware-backed session | 2/5 | 1/5 | 5/5 | 1/5 | 2/5 | 2/5 | 4/5 | 5/5 | 2/5 |
| Private Interaction History | 0/5 | 3/5 | 3/5 | 4/5 | 1/5 | 2–3/5 | 1/5 | 5/5 | 3/5 |
| Liveness + behavioral | 2/5 | 5/5 | 3/5 | 1/5 | 5/5 | 5/5 | 3/5 | 3/5 | 3/5 |
| Social / graph personhood | 4/5 | 1/5 | 1/5 | 1/5 | 3/5 | 4/5 | 1/5 | 3/5 | 1/5 |
| Biometric PoP | 5/5 | 1/5 | 2/5 | 1/5 | 5/5 | 4/5 | 5/5 | 3/5 | 1/5 |

結論很明確：**沒有任何一個單獨方案能強力證明 Human Cognitive Work。**

最難的 T3 攻擊：

```text
real human handles authentication / liveness
+
AI handles cognition
```

只能透過多層組合提高成本，無法靠單一 biometric、WebAuthn 或「AI 不擅長的題目」完全排除。

---

## 6. Proof of Contribution：不要把「多數一致」當成品質

工作量必須與「有效貢獻」分開。

例如，使用者連續點擊一千次沒有資訊價值的按鈕，雖然消耗時間，但不應取得高 PoHW。

### 6.1 Contribution signals

可使用：

- gold tasks / known-answer audit
- delayed retest
- peer validation
- downstream usefulness
- information gain
- disagreement resolution
- calibration
- peer prediction / conditional correlation

2025 年已有研究直接討論 LLM-corrupted crowdsourcing data，嘗試利用 peer-prediction 與條件相關性辨識低努力或 LLM 汙染的群眾工作；這比單純檢查文字「像不像 AI」更接近 PoHW 要測量的有效獨立資訊。[Zhang et al., 2025](https://arxiv.org/abs/2506.06991)

### 6.2 初期 contribution score

Prototype 可先使用易於解釋的組合：

\[
C = w_gG + w_rR + w_iI + w_pP_q
\]

其中：

- \(G\)：gold task accuracy
- \(R\)：retest stability / task-specific consistency
- \(I\)：information gain
- \(P_q\)：peer / downstream quality

不應直接把 response time 當品質；時間只適合描述投入與攻擊成本。

---

## 7. 攻擊經濟：PoHP 最值得最佳化的核心

本研究不建議設定：

```text
AI success rate = 0%
```

作為目標，因為這很可能隨模型能力進步失效。

更合理的工程指標：

\[
\rho =
\frac{C_{successful\ AI\ proxy}}
     {C_{honest\ human\ completion}}
\]

這裡的成本可以包含：

- API / inference 成本
- GPU / local model 成本
- context relay bandwidth
- automation development time
- human operator time
- credential acquisition cost
- failed-session expected loss
- liveness / step-up handling cost
- latency penalty

初始研究可把：

- 一般低價值工作：\(\rho \ge 3\)
- 有直接經濟獎勵工作：\(\rho \ge 10\)

當作 **prototype engineering targets**，但這兩個數字不是既有標準，必須透過實驗校正。

另一個重要概念是 attack break-even：

\[
ExpectedReward_{attack} - ExpectedCost_{attack} < 0
\]

只要攻擊的期望收益為負，就不必宣稱 AI 技術上「做不到」。

---

## 8. 建議架構：漸進式 assurance

研究建議採取 risk-based step-up，而不是所有使用者都被迫錄影、提供虹膜或加入 social ceremony。

```text
Account / pseudonym
        |
        v
WebAuthn or device-bound key
        |
        v
Attested / signed session
        |
        v
Private Interaction History
        |
        v
Contribution audit
        |
        +------ normal ------> PoHP Receipt (L1/L2)
        |
        +------ high risk / high reward
                    |
                    v
              random liveness
                    |
                    v
           personhood credential
                    |
                    v
             higher assurance receipt
```

### Assurance levels

| Level | 建議證據 | 適用情境 |
| --- | --- | --- |
| **L0** | server-signed transcript | 無獎勵實驗、研究資料 |
| **L1** | L0 + WebAuthn/session key + PIH | 一般 crowdsourcing / reputation |
| **L2** | L1 + endpoint attestation + contribution audit | 有限獎勵、平台資格 |
| **L3** | L2 + randomized liveness / continuity | 高價值工作、攻擊誘因高 |
| **L4** | L3 + strong personhood credential | 一人一次權利、治理、重大分配 |

---

## 9. PoHP Receipt 設計

Receipt 不應輸出 `human=true`。建議輸出可驗證 evidence vector：

```json
{
  "version": "pohp-receipt/0.1",
  "session_id": "s_01...",
  "subject": "did:key:...",
  "started_at": "2026-09-07T10:00:00Z",
  "ended_at": "2026-09-07T10:12:31Z",
  "task_class": "pairwise-judgment",
  "transcript_root": "sha256:...",
  "evidence": {
    "uniqueness": {
      "level": 0,
      "mechanisms": []
    },
    "presence": {
      "level": 2,
      "mechanisms": ["private-interaction-history", "random-cross-probe"]
    },
    "endpoint_integrity": {
      "level": 2,
      "mechanisms": ["webauthn", "session-signature"]
    },
    "contribution": {
      "level": 3,
      "score": 0.82,
      "mechanisms": ["gold-task", "retest", "information-gain"]
    }
  },
  "metrics": {
    "active_seconds": 611,
    "challenge_count": 43,
    "audit_count": 6,
    "audit_pass_rate": 0.833
  },
  "issuer": "https://example.org",
  "signature": "..."
}
```

Receipt 的價值在於 verifier 可以自行設定 policy：

```text
accept if:
    endpoint_integrity.level >= 2
    presence.level >= 2
    contribution.score >= 0.75
```

而不是把不同 trust assumptions 混成單一分數。

---

## 10. 最值得 prototype 的三條路線

## Prototype 1 — PIH + Signed Session Receipt

**推薦優先度：最高。**

### 目的

驗證最基本的研究命題：session-private、不可預測、依賴前序狀態的互動是否能顯著提高 AI proxy 成本。

### MVP 元件

- backend challenge engine
- server nonce
- hash-chained transcript
- WebAuthn 或 session signing key
- PIH adaptive task
- delayed cross-probe
- receipt generator / verifier
- adversarial benchmark harness

### 必須比較

1. honest human
2. naive batch LLM
3. realtime LLM relay
4. browser agent
5. human + AI copilot

### 核心指標

- attack success rate
- human completion rate
- human median time
- AI proxy inference / API cost
- relay latency
- false reject rate
- challenge annoyance rate
- \(\rho\) cost ratio

---

## Prototype 2 — Device-bound Endpoint + PIH

在 Prototype 1 基礎上加入：

- Android Play Integrity / Key Attestation，或
- Apple App Attest，或
- TPM / native desktop attestation

目的不是「證明真人」，而是測試可信 endpoint 能否顯著提高 automation 與 transcript forgery 成本。

此 prototype 尤其適合比較：

```text
web-only attacker
vs
compromised browser extension
vs
remote-control attacker
vs
instrumented native client
```

---

## Prototype 3 — Risk-based Presence Step-up

在高價值 session 中加入少量、不可預測的 liveness / presence challenge。

重點不是把攝影機一直打開，而是實驗：

- 0 次 liveness
- session start 1 次
- random 1–2 次
- risk-triggered step-up

對 T3 human+AI relay 的成本差異。

若隨機 step-up 對攻擊成本幫助有限，應直接否決這條技術路線，而不是因為「看起來更安全」就永久保留。

---

## 11. 隱私與法規

台灣《個人資料保護法》要求個人資料蒐集、處理與利用不得逾越特定目的必要範圍，並規定蒐集時的告知義務。[全國法規資料庫：個人資料保護法](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021)

因此設計上應遵守：

- 最小資料蒐集
- biometric 不作為預設必要條件
- behavioral raw data 儘可能在端點轉成短期統計特徵
- receipt 優先保存 proof / aggregate，而非原始影像與完整行為流
- personhood 與工作 pseudonym 盡可能 unlinkable
- 高風險 evidence 使用明確 step-up consent
- 設計 retention / deletion policy

台灣個資主管機關亦有針對臉部、虹膜等高識別性資料的相關解釋與指引，可在 biometric prototype 前再進一步做法遵分析：[個人資料保護委員會籌備處](https://www.pdpc.gov.tw/)

---

## 12. 主要研究結論

1. **偏好排序不是 human proof。** AI 可以模擬偏好；其價值在 Contribution，而非 Human-ness。
2. **沒有單一純數位認知 challenge 能穩定證明「人腦完成」。** 能力型 CAPTCHA 會隨模型進步退化。
3. **WebAuthn / attestation 證明 endpoint / key，不證明人腦。** 但它是 receipt integrity 很有價值的基礎。
4. **Liveness 證明特定時點的活體存在信心，不證明整段工作由人類完成。**
5. **Proof of Personhood 解的是 uniqueness / Sybil 問題，不是 work participation。**
6. **T3 Human+AI relay 是 PoHW 最重要的威脅模型。** 真人登入、AI 工作，不能被傳統 CAPTCHA 或 KYC 解決。
7. **最可行的工程目標是攻擊經濟。** 讓成功 AI proxy 的成本、風險與操作負擔顯著高於誠實人類完成。
8. **PIH 最值得先 prototype。** 它低隱私、低硬體依賴、容易做 A/B 與紅隊實驗，也最容易被研究結果否證。
9. **PoHP 應輸出 evidence vector，而不是 Boolean。** verifier 應知道每項 claim 的信任假設。
10. **Biometric 與 personhood 應放在高價值 step-up，而不是 MVP 起點。**

---

## 13. 參考資料

### WebAuthn / 硬體與裝置驗證

- W3C Web Authentication Working Group Charter: https://www.w3.org/2026/08/wg-webauthn-charter.html
- FIDO Alliance — Passkeys: https://fidoalliance.org/passkeys/
- Android — Verify hardware-backed key pairs with key attestation: https://developer.android.com/privacy-and-security/security-key-attestation
- Android — Play Integrity API: https://developer.android.com/google/play/integrity/overview
- Microsoft — Device Health Attestation: https://learn.microsoft.com/en-us/windows-server/security/device-health-attestation

### Liveness / Presentation Attack

- NIST SP 800-63A-4: https://pages.nist.gov/800-63-4/sp800-63a.html
- Li et al., *Security Analysis of Face Recognition Systems under Deepfake Attacks*: https://arxiv.org/abs/2202.10673
- AWS Rekognition pricing / Face Liveness cost reference: https://aws.amazon.com/rekognition/pricing/

### Proof of Personhood / Sybil Resistance

- Bryan Ford, *Identity and Personhood in Digital Democracy*: https://arxiv.org/abs/2011.02412
- Tran et al., *Sybil-Resilient Online Content Voting*: https://www.usenix.org/legacyurl/sybil-resilient-online-content-voting
- World ID: https://world.org/world-id

### Contribution / AI-corrupted Crowdsourcing

- Zhang et al. 2025, LLM-corrupted crowdsourcing / peer-prediction research: https://arxiv.org/abs/2506.06991

### 台灣法規

- 個人資料保護法：https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021
- 個人資料保護委員會籌備處：https://www.pdpc.gov.tw/

---

## 14. 後續研究問題

本報告仍留下幾個需要 prototype 才能回答的核心問題：

1. PIH 對最新 browser-use / multimodal agent 實際能提高多少成本？
2. challenge 密度與正常工作 UX 的 Pareto frontier 在哪裡？
3. 哪些 task family 能同時產生 useful contribution 與高 session dependency？
4. 本機模型將 inference cost 幾乎降為零後，PIH 還能依靠 latency / state complexity / credential scarcity 形成多少防禦？
5. device attestation 對 remote AI relay 的實際增益有多少？
6. 隨機 liveness 是否真的能提高 T3 成本，還是只增加正常使用者摩擦？
7. 如何讓 receipt 在不洩漏完整 transcript 的情況下證明工作量與 challenge coverage？是否需要 Merkle disclosure / zero-knowledge proof？
8. 如何定義跨 task 可比較的 Human Work Unit，而不把「花時間」錯當成「有價值工作」？

這些問題應作為後續實作與實驗的主要研究主軸。
