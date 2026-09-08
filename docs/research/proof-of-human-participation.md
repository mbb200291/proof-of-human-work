# Proof of Human Participation（PoHP）設計研究

> 研究日期：2026-09-08  
> 專案：Proof of Human Work  
> 狀態：Research baseline / 可供 prototype 設計使用

## 1. 研究問題

本研究探討下列問題：

> 在 AI 與代理程式已能完成大量純數位認知工作的條件下，能否建立一套可驗證機制，對「某個真實且盡可能唯一的人類，在一段時間內確實投入不可忽略的參與或工作量，並產生可驗證貢獻」提供具有明確信任假設的證據？

研究目標不同於傳統 CAPTCHA 的單次真人判定，也不假設可從最終輸出可靠辨識 AI 是否參與。目標是建立一組可組合、可量測、可由 verifier 解讀的 **assurance evidence**。

研究範圍包括：

- Proof of Personhood / Sybil resistance
- WebAuthn、device-bound credential、硬體 attestation
- liveness / presentation attack detection
- behavioral continuity
- CAPTCHA、risk scoring 與 anti-automation
- crowdsourcing quality control、gold task、peer validation、peer prediction
- Private Interaction History（PIH）與不可預測 session
- 社交圖譜與多人背書
- biometric uniqueness
- Privacy Pass / privacy-preserving attestation
- 攻擊經濟與分級 assurance

---

## 2. 理論界線

### 2.1 純 challenge-response 無法直接證明「人腦完成」

若 verifier 僅能觀察：

```text
challenge -> response
```

且人類與 AI 可以取得相同 challenge，並透過相同數位通道送出 response，則 verifier 無法直接觀察中間的認知執行者究竟是：

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

因此，「某種題目目前 AI 很難解」只能形成依賴當代模型能力的暫時性區隔，不能構成穩定的安全根。偏好排序、圖像辨識、邏輯題、文字生成、多輪一致性，以及刻意模擬猶豫或錯誤，均不具備足以單獨證明人類認知來源的性質。

CAPTCHA 與 facial-liveness 的攻防研究亦呈現相同限制：當安全性建立於機器對某類感知或認知任務的能力劣勢時，模型能力進步會持續改變可區分邊界。[Li et al., 2022](https://arxiv.org/abs/2202.10673)

### 2.2 PoHW 應表示為 assurance composition

本研究將 Proof of Human Work 的可實作核心定義為：

> **Proof of Human Participation（PoHP）**：提供一組分別支持真人唯一性、持續參與、工作通道完整性與有效貢獻的可驗證證據，而不宣稱「AI 不曾介入」。

使用四維 assurance vector：

\[
PoHP = (U, P, E, C)
\]

| 維度 | 名稱 | 要回答的問題 |
| --- | --- | --- |
| **U** | Uniqueness | 此 credential 是否盡可能對應到一個唯一真人？ |
| **P** | Presence | 真人是否在指定工作期間持續參與？ |
| **E** | Endpoint Integrity | 互動紀錄是否來自預期裝置／應用程式，且未被事後偽造？ |
| **C** | Contribution | 工作是否提供具有品質與資訊價值的貢獻？ |

這四個維度不應壓縮為 `verified_human=true`。一份 receipt 應揭露各維度的 assurance level、採用機制與信任假設。

---

## 3. 威脅模型

PoHP 必須將「真人協助 AI」列為一級威脅，而非只處理傳統 bot。

### T0 — Replay / fabricated transcript

攻擊者重播舊 session、偽造 timestamp、修改工作紀錄，或事後生成整份 transcript。

**主要防禦：** server nonce、hash chain、Merkle root、簽章、session key、短效 challenge。

### T1 — Automated bot

完全由程式自動執行工作，沒有真人參與。

**主要防禦：** WebAuthn user verification、裝置綁定、PIH、不可預測 challenge、risk-based presence check。

### T2 — Remote AI agent

AI 代理即時讀取任務、維持 session 狀態並產生回應。

**主要防禦：** 不依賴題目本身的 AI 能力差距；以 PIH、可信 endpoint、隨機抽查與成本放大增加代理成本。

### T3 — Human + AI relay

真人負責登入、passkey 或 liveness；AI 負責主要認知工作。此類 relay 是本研究最重要的威脅模型。

**主要防禦：** 目前不存在能單獨排除此攻擊的通用機制。可透過持續 presence、session-private context、可信 endpoint、工作抽查、重新詢問與整批失效政策提高 relay 成本，但不能將其表述為「證明沒有 AI 參與」。

### T4 — Account rental / Sybil farm

大量真人出租帳號、執行 liveness、代按認證，或攻擊者大量取得低成本「真人身份」。

**主要防禦：** Proof of Personhood、credential 稀缺性、social graph、biometric uniqueness、rate limit、reputation、stake/slashing、跨 session 統計。

---

## 4. 既有 CAPTCHA 與反自動化機制回顧

### 4.1 分析範圍與術語

CAPTCHA 原始設計目標可概括為：提供一項「人類容易完成、電腦難以自動完成」的公開挑戰，據此區分人與自動化程式。此模型的安全性依賴一項能力差距：

\[
Advantage = Success_{human} - Success_{automation}
\]

當 OCR、電腦視覺、多模態模型與瀏覽器代理能力提升時，該差距會縮小。現代商用 CAPTCHA 因此逐步從單一認知 challenge，演化為綜合多種 client/server 訊號的 **anti-abuse risk assessment**。Google 目前甚至明確指出，視覺 CAPTCHA 因電腦視覺與機器智慧進步而降低區分人與 bot 的效用，並指出付費真人解題同樣能繞過 challenge。[Google Cloud — Choose the appropriate key type](https://docs.cloud.google.com/recaptcha/docs/choose-key-type)

本節將現代 CAPTCHA 相關機制區分為五類：

1. **能力型 challenge**：要求解文字、影像、音訊或其他認知任務。
2. **風險評分**：由背景訊號計算 interaction risk，不必顯示 challenge。
3. **瀏覽器／執行環境 challenge**：驗證瀏覽器執行特性、API 能力或計算工作。
4. **Adaptive / passive verification**：依風險動態決定是否提高摩擦。
5. **Attestation token**：由受信任 issuer 對裝置、帳號或既有驗證結果背書，讓 origin 不必重新要求 CAPTCHA。

這五類機制在安全語意上並不等價，也不能直接視為 Proof of Human Work。

### 4.2 現代 CAPTCHA 的通用協定結構

目前主流方案通常採用「client assessment + short-lived token + server verification」架構：

```text
Client / Browser
      |
      |  client-side assessment or challenge
      v
CAPTCHA / Anti-abuse Provider
      |
      |  opaque token
      v
Application Backend
      |
      |  server-to-server verification / assessment
      v
Policy Decision
      |
      +-- allow
      +-- throttle
      +-- require MFA
      +-- issue additional challenge
      +-- reject
```

此架構具有兩個重要性質。

第一，client 顯示「通過」不構成完整驗證；應用程式後端仍需驗證 token、action、hostname、時效或供應商回傳的風險資訊。Google reCAPTCHA、Cloudflare Turnstile 與 hCaptcha 的正式整合流程皆包含後端驗證步驟。[Google reCAPTCHA v3](https://developers.google.com/recaptcha/docs/v3) [Cloudflare Turnstile — Get started](https://developers.cloudflare.com/turnstile/get-started/) [hCaptcha Developer Guide](https://docs.hcaptcha.com/)

第二，供應商實際使用的風險模型與特徵通常不是公開協定的一部分。因此，本報告僅將官方文件明確揭露的訊號列為已知機制；未公開的模型特徵不作推測。

### 4.3 傳統 challenge-based CAPTCHA

傳統 CAPTCHA 直接要求使用者解決一個認知任務，例如：

- 辨識扭曲文字；
- 從圖片集合選出指定物件；
- 音訊辨識；
- 簡單邏輯或互動題。

其安全 claim 僅能表述為：

> 在指定 challenge family、指定攻擊模型與指定時間點下，提交者展現了足以通過該 challenge 的能力。

它不能推出下列結論：

- 提交者具有唯一真人身份；
- 整個 session 持續由真人操作；
- challenge 以外的工作由真人完成；
- 使用者沒有將 challenge 轉送給真人解題服務或 AI；
- 通過 challenge 的同一個主體之後仍持續操作。

因此，challenge CAPTCHA 對 PoHP 的 **U、P、E、C** 四維證據均有限。它最主要的功能是提高低成本、大規模自動化的門檻，而非產生可驗證的 human-work claim。

### 4.4 Google reCAPTCHA：從 checkbox 轉向 score-based risk assessment

#### 4.4.1 現行模式

Google Cloud reCAPTCHA 目前對 Web 提供三類主要 key：

- **Score-based key (`SCORE`)**：不顯示 CAPTCHA challenge，由後端取得風險分數。
- **Checkbox key (`CHECKBOX`)**：顯示「I'm not a robot」核取方塊，並可能進一步觸發 CAPTCHA challenge。
- **Policy-based challenge key (`POLICY_BASED_CHALLENGE`)**：先計算風險分數，再依設定門檻決定是否明確觸發 CAPTCHA challenge。

Google 官方目前建議優先採用 score-based key，並明確不建議一般情況使用 checkbox key，理由是 checkbox 增加使用者摩擦，但不會顯著提升準確率。[Google Cloud — Choose the appropriate key type](https://docs.cloud.google.com/recaptcha/docs/choose-key-type)

#### 4.4.2 評分與後端決策

reCAPTCHA 的核心已由「是否答對題目」轉向「對 interaction 建立風險評估」。官方文件指出，上述 Web key 類型會依網站互動產生 score；應用程式可將 score 與 action 等資料納入自己的政策，例如：

```text
high confidence
    -> allow

medium risk
    -> additional verification / moderation / throttling

high risk
    -> challenge / reject
```

傳統 reCAPTCHA v3 的公開介面以 0.0–1.0 score 表示風險傾向，並使用 `action` 區分登入、註冊、購買等行為脈絡。Google 建議在多個重要 action 取得 assessment，而非僅在單一入口執行一次檢查。[Google reCAPTCHA v3](https://developers.google.com/recaptcha/docs/v3)

#### 4.4.3 可支持與不可支持的 claim

reCAPTCHA score 可以支持：

- 某次 interaction 在供應商模型下具有較高或較低的自動化／濫用風險；
- 特定 action 是否應進一步升級驗證；
- 在累積網站脈絡後進行更細緻的 policy decision。

它不能直接支持：

- `unique_human = true`；
- 指定時間區間內真人持續在場；
- 認知工作由人腦完成；
- AI agent 沒有參與；
- 工作結果具有品質或資訊價值。

對 PoHW 而言，reCAPTCHA 最值得借鑑的設計是 **risk-based step-up** 與 **action-specific assessment**，而不是其 challenge 題型。

### 4.5 Cloudflare Turnstile：瀏覽器環境 challenge 與低摩擦驗證

#### 4.5.1 已公開機制

Cloudflare 將 Turnstile 定位為 CAPTCHA alternative。Turnstile 可以獨立嵌入網站，不要求網站流量必須經過 Cloudflare CDN。其官方文件指出，Turnstile 首先在瀏覽器中執行一系列小型、非互動式 JavaScript challenges，以取得 visitor/browser environment 相關訊號。公開列出的 challenge 包括：

- computational proof-of-work；
- proof-of-space；
- Web API probing；
- browser quirks；
- 與 human behavior 相關的其他 challenge。

Turnstile 會依個別 visitor/browser 的結果調整後續 challenge，而非固定要求所有使用者解同一個視覺題。[Cloudflare Turnstile — Overview](https://developers.cloudflare.com/turnstile/)

#### 4.5.2 Token 驗證流程

Turnstile widget 在瀏覽器執行後產生 token；應用程式後端必須再將 token 送至 Cloudflare 驗證。單純接受 client 回傳的「成功」狀態並不構成安全整合。[Cloudflare Turnstile — Get started](https://developers.cloudflare.com/turnstile/get-started/)

其抽象流程可表示為：

```text
browser environment
      |
      +-- JS challenge
      +-- computational challenge
      +-- API / execution probes
      v
Turnstile assessment
      |
      v
opaque token
      |
      v
backend Siteverify
      |
      v
application policy
```

#### 4.5.3 對 PoHW 的意義

Turnstile 顯示一項成熟的 anti-automation 設計原則：**不要把安全性綁定在單一「AI 尚未解得好」的認知題，而應結合多個成本不同、可動態替換的環境與行為訊號。**

但 Turnstile 仍主要處理 request legitimacy / automation risk。即使某個 request 通過 Turnstile，也不能推出「後續 30 分鐘工作由真人完成」。因此其機制較適合作為 PoHW 的 session admission 或 endpoint-risk signal，而不是最終 PoHP receipt。

### 4.6 hCaptcha：active、invisible、passive 與 adaptive verification

#### 4.6.1 模式

hCaptcha 現有產品同時包含傳統 challenge 與低摩擦風險評估：

- **Visible / challenge mode**：使用者直接完成 CAPTCHA challenge。
- **Invisible mode**：不顯示 checkbox；client/server interaction 在背景執行，只有符合 challenge criteria 時才要求使用者解題。
- **Passive mode**：不顯示可見 challenge，依被動機制與 risk score 進行判定；此模式屬 Enterprise 功能。
- **99.9% Passive mode**：依風險評估選擇性出題，官方目標是將真人收到 challenge 的比例降低至 0.1% 以下，同時持續提高攻擊成本。[hCaptcha — Invisible Captcha](https://docs.hcaptcha.com/invisible)

#### 4.6.2 動態成本機制

hCaptcha 官方文件指出，99.9% Passive 模式的 decision 來自「thousands of factors」，且即使沒有顯示視覺 challenge，仍會在 request 上執行其他 security controls，其中包括 **advanced dynamic proofs of work**。[hCaptcha — Pro Features](https://docs.hcaptcha.com/pro)

Enterprise 驗證結果可包含 malicious-activity score 與 score reason；正式整合仍要求 application backend 驗證 passcode，而不能只相信 browser-side 結果。[hCaptcha Developer Guide](https://docs.hcaptcha.com/)

#### 4.6.3 對 PoHW 的意義

hCaptcha 的價值不在於證明某個 challenge 是「只有人會做」，而在於展示下列架構：

```text
passive assessment
      |
      +-- low risk -> no visible challenge
      |
      +-- elevated risk -> active challenge
      |
      +-- continuous background cost controls
```

此模式可直接轉化為 PoHW 的 **step-up presence** 設計：低風險 session 僅蒐集低摩擦證據；高獎勵、高風險或偵測到 relay pattern 時，再要求更強的 presence / endpoint evidence。

### 4.7 Privacy Pass / Apple Private Access Tokens：以匿名 attestation 取代重複 CAPTCHA

Privacy Pass 與 Apple Private Access Tokens 不屬於傳統 CAPTCHA，但代表另一條重要演化路徑：不再要求每個 origin 自行辨識「你是不是人」，而由受信任 issuer 對先前完成的 authentication、attestation 或 challenge 結果簽發不可連結 token。

RFC 9577 將 Privacy Pass token 定義為 **unlinkable authenticator**。Token 可以基於 authentication、attestation，或先前完成 CAPTCHA 等行為簽發；持有者向 origin 出示 token 時，可以證明自己曾符合 issuer 的簽發條件，而不必讓 origin 將 token redemption 與 issuance flow 直接連結。[RFC 9577 — The Privacy Pass HTTP Authentication Scheme](https://datatracker.ietf.org/doc/html/rfc9577)

Apple Private Access Tokens 將此架構應用於支援的 Apple 裝置。Apple 的公開說明指出，issuer 對 client 完成 attestation 的事實進行密碼學簽署，而 origin 驗證 token 時不需要取得 client 的直接身份。[Apple — Replace CAPTCHAs with Private Access Tokens](https://developer.apple.com/videos/play/wwdc2022/10077/)

抽象流程如下：

```text
Origin
  |
  | PrivateToken challenge
  v
Client ---------> Attester / Issuer
                    |
                    | evaluate issuance policy
                    v
              unlinkable token
                    |
Client <------------+
  |
  | redeem token
  v
Origin verifies issuer signature
```

此機制能證明的是：

> client 曾滿足某個 issuer 的 token issuance policy。

它不能自動轉化為：

> client 是唯一真人，或後續工作由真人認知完成。

Privacy Pass 對 PoHW 的主要價值在於 **privacy-preserving evidence delegation**。未來 PoHP receipt 可以借鑑相同思想，使 verifier 驗證「曾通過某種 personhood / presence / endpoint policy」，而不必取得原始生物資料、完整裝置身份或全部互動紀錄。

### 4.8 現有機制比較

下表的「主要 claim」描述各系統公開設計最合理能支持的安全語意，不代表供應商服務等級或認證結果。

| 機制 | 主要安全來源 | 使用者摩擦 | 主要 claim | 對即時 AI agent | 對 Human+AI relay | 對 PoHW 可重用元件 |
| --- | --- | ---: | --- | --- | --- | --- |
| 傳統圖像／文字 CAPTCHA | 人機能力差距 | 高 | 通過指定 challenge | 弱，依模型能力而變 | 很弱 | 隨機 challenge、抽查 |
| reCAPTCHA score-based | interaction risk model | 低 | interaction risk | 中，模型與訊號未公開 | 弱 | risk score、action-specific policy、step-up |
| reCAPTCHA checkbox / policy challenge | risk score + active challenge | 中～高 | interaction risk + challenge completion | 中 | 弱 | adaptive challenge |
| Cloudflare Turnstile | browser/environment challenges + adaptive assessment | 低 | browser/request legitimacy signal | 中～高，取決於 agent 控制面 | 弱 | 多訊號組合、client token、server verify |
| hCaptcha passive/adaptive | risk scoring + dynamic controls + optional challenge | 低～高 | automation / malicious activity risk | 中～高 | 弱 | continuous controls、step-up、proof-of-work |
| Privacy Pass / Private Access Tokens | issuer attestation + unlinkable token | 很低 | 曾符合 issuer policy | 取決於 issuance policy | 取決於 issuance policy | 匿名 credential、證據解耦 |

### 4.9 CAPTCHA 與 Proof of Human Work 的能力邊界

現代 CAPTCHA 系統主要回答：

> **此 request / interaction 是否具有足夠低的自動化或濫用風險，可以被接受？**

PoHW 所需要的 claim 更強：

> **在指定時間區間內，是否存在具有足夠 assurance 的真人持續參與，而且該參與產生了可驗證工作貢獻？**

兩者在時間尺度與證據對象上不同。設 `A_t` 表示時間 `t` 的 admission evidence，`W_[t0,t1]` 表示整段工作參與，則：

\[
A_{t_0} \not\Rightarrow W_{[t_0,t_1]}
\]

例如：

```text
09:00  human passes anti-bot assessment
          |
          v
09:01  AI agent takes control
          |
          v
09:30  task completed
```

此流程可能符合 CAPTCHA 的 admission policy，卻不滿足 PoHW 對持續 human participation 的要求。

因此，現有 CAPTCHA 機制在本專案中應定位為 **可組合的證據元件**，而不是 PoHW 本身：

- reCAPTCHA / Turnstile / hCaptcha：可提供 anti-automation risk signal；
- challenge：可用作隨機抽查，但不作為人類認知證明；
- browser challenge：可提高大規模 automation 成本；
- Privacy Pass：可用於匿名轉移既有 assurance；
- risk-based step-up：可作為 PoHP 的核心 orchestration pattern。

這項回顧同時支持本報告的基本設計原則：**PoHW 不應尋找一個「新的、更難的 CAPTCHA」，而應建立可持續收集、組合、揭露與驗證多種 assurance evidence 的工作協定。**

---

## 5. 五類 PoHP 可行方案

## 5.1 方案 A：Hardware-backed Attested Session

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

W3C WebAuthn 定義 public-key credential、簽章與 attestation；Android Key Attestation 可提高「金鑰位於 hardware-backed keystore」的信心；FIDO 亦區分可同步與 device-bound passkey。[W3C](https://www.w3.org/2026/08/wg-webauthn-charter.html) [FIDO Alliance](https://fidoalliance.org/passkeys/) [Android](https://developer.android.com/privacy-and-security/security-key-attestation)

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

- transcript integrity 強。
- 可大規模部署。
- 不一定需要生物資料。
- 適合作為其他方案的基礎層。

**缺點**

- 對「人類認知」的直接證明弱。
- Web 平台與原生 app 的 attestation 能力不一致。
- 產生裝置相容性與供應商依賴。

### 適合 claim

- U：低～中
- P：低
- E：高
- C：無直接幫助

---

## 5.2 方案 B：Private Interaction History（PIH）

### 核心概念

讓工作 session 建立一段只有該 session 即時取得的私人互動歷史。下一步 challenge 依賴：

```text
server entropy
+ previous response
+ session state
+ short-lived context
```

產生不可預先大量抓取的 ephemeral stimulus。

安全目標不是使 AI 無法理解，而是迫使攻擊者即時跟隨完整 session、維護狀態並承擔 latency、API、context relay 與失敗成本。

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
- 提高「取得題庫 → 丟給 LLM → 批次提交」的成本。
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
- 可直接整合實際工作流程。
- 適合進行可量測 adversarial benchmark。
- 安全目標可明確轉為「提高 AI 代理成本」。

**缺點**

- 強 AI 仍可能完成。
- challenge 過多會降低 UX 與真實工作價值。
- 設計不當時容易退化為新型 CAPTCHA。

### 適合 claim

- U：無
- P：中
- E：中（若與簽章整合）
- C：中～高

---

## 5.3 方案 C：Liveness + Behavioral Continuity

### 核心概念

在 session 中不定期要求 liveness，並持續觀察與工作相關的行為 continuity，例如輸入節奏、指標操作、觸控模式、視線或攝影機訊號。

NIST SP 800-63A-4 對 biometric presentation attack detection（PAD）有明確要求，並要求測試符合 ISO/IEC 30107-3:2023；正式 liveness 系統不應將單張自拍視為高 assurance 證據。[NIST SP 800-63A-4](https://pages.nist.gov/800-63-4/sp800-63a.html)

### Protocol sketch

```text
session start -> strong liveness
work stream -> behavioral continuity
random intervals -> active / passive liveness
risk spike -> step-up challenge
session end -> continuity score + evidence receipt
```

### 可以證明

- 工作期間多個時間點存在真人活體訊號。
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
- 深偽與 presentation attack 需要持續紅隊測試。
- 容易增加正常使用者的監控感受。

### 適合 claim

- U：低～中
- P：高
- E：中
- C：無直接幫助

---

## 5.4 方案 D：Social / Graph Personhood

### 核心概念

將 Sybil resistance 建立在「取得大量可信社會關係的成本高於建立大量虛假帳號」的假設上。

SumUp、SybilGuard、SybilLimit 類研究的共同精神是：建立大量 node 很便宜，但取得大量穿越 honest region 的可信 social edges 相對困難。SumUp 以 trust network 建立 Sybil-resilient voting。[USENIX: Sybil-Resilient Online Content Voting](https://www.usenix.org/legacyurl/sybil-resilient-online-content-voting)

Proof-of-Personhood 文獻亦研究實體 pseudonym party、面對面 encounters 與一人一 credential 的可能性。[Ford, Proof-of-Personhood](https://arxiv.org/abs/2011.02412)

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
- 可形成不依賴單一中央 KYC 的 personhood assurance。

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
- 社會結構偏差可能轉化為制度偏差。
- 對單次工作 participation 幫助有限。

### 適合 claim

- U：中～高
- P：低
- E：低
- C：低

---

## 5.5 方案 E：Biometric PoP + Privacy-preserving Credential

### 核心概念

使用虹膜、臉部或其他 biometric 建立 uniqueness，再發行可匿名使用的 personhood credential，使後續工作驗證不必揭露原始 biometric。

World ID 是現有大規模案例之一：以專用 enrollment 硬體與虹膜相關流程建立 unique humanness，再以 credential 提供 personhood 證明。[World ID](https://world.org/world-id)

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

- 在既定 biometric 系統與 enrollment 假設下，提供較強的一人一 credential assurance。

### 不能證明

- 該人持續參與工作。
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
- 適合「一人只能領一次高價值權利」場景。

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

## 6. PoHP 方案比較矩陣

評分僅表示相對工程評估，不代表既有標準認證。

| 方案 | U | P | E | C | 隱私成本 | 使用摩擦 | 硬體依賴 | 可擴展性 | 對 T3 Human+AI relay |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Hardware-backed session | 2/5 | 1/5 | 5/5 | 1/5 | 2/5 | 2/5 | 4/5 | 5/5 | 2/5 |
| Private Interaction History | 0/5 | 3/5 | 3/5 | 4/5 | 1/5 | 2–3/5 | 1/5 | 5/5 | 3/5 |
| Liveness + behavioral | 2/5 | 5/5 | 3/5 | 1/5 | 5/5 | 5/5 | 3/5 | 3/5 | 3/5 |
| Social / graph personhood | 4/5 | 1/5 | 1/5 | 1/5 | 3/5 | 4/5 | 1/5 | 3/5 | 1/5 |
| Biometric PoP | 5/5 | 1/5 | 2/5 | 1/5 | 5/5 | 4/5 | 5/5 | 3/5 | 1/5 |

沒有任何單一方案能對 Human Cognitive Work 提供強證明。

最困難的 T3 攻擊為：

```text
real human handles authentication / liveness
+
AI handles cognition
```

多層組合的作用是提高此攻擊的成本與失敗風險，而非藉單一 biometric、WebAuthn 或能力型 challenge 完全排除 AI 介入。

---

## 7. Proof of Contribution：工作量與品質必須分離

工作量必須與「有效貢獻」分開衡量。使用者連續點擊一千次沒有資訊價值的按鈕，即使消耗時間，也不應取得高 PoHW。

### 7.1 Contribution signals

可使用：

- gold tasks / known-answer audit
- delayed retest
- peer validation
- downstream usefulness
- information gain
- disagreement resolution
- calibration
- peer prediction / conditional correlation

2025 年已有研究直接討論 LLM-corrupted crowdsourcing data，嘗試利用 peer-prediction 與條件相關性辨識低努力或 LLM 汙染的群眾工作；此方向比直接判斷文字「像不像 AI」更接近 PoHW 對有效獨立資訊的量測需求。[Zhang et al., 2025](https://arxiv.org/abs/2506.06991)

### 7.2 初期 contribution score

Prototype 可先使用易於解釋的組合：

\[
C = w_gG + w_rR + w_iI + w_pP_q
\]

其中：

- \(G\)：gold task accuracy
- \(R\)：retest stability / task-specific consistency
- \(I\)：information gain
- \(P_q\)：peer / downstream quality

Response time 不應直接作為品質分數；時間僅適合描述投入程度與攻擊成本。

---

## 8. 攻擊經濟

PoHP 不應以：

```text
AI success rate = 0%
```

作為必要成功條件，因為此條件很可能隨模型能力進步失效。

較合理的工程指標為：

\[
\rho =
\frac{C_{successful\ AI\ proxy}}
     {C_{honest\ human\ completion}}
\]

成本可以包含：

- API / inference 成本
- GPU / local model 成本
- context relay bandwidth
- automation development time
- human operator time
- credential acquisition cost
- failed-session expected loss
- liveness / step-up handling cost
- latency penalty

初始研究可將：

- 一般低價值工作：\(\rho \ge 3\)
- 有直接經濟獎勵工作：\(\rho \ge 10\)

設定為 **prototype engineering targets**。這兩個數字不是既有標準，必須由實驗校正。

另一個重要條件是 attack break-even：

\[
ExpectedReward_{attack} - ExpectedCost_{attack} < 0
\]

只要攻擊期望收益為負，就不需要宣稱 AI 在技術上無法完成工作。

---

## 9. 建議架構：漸進式 assurance

建議採用 risk-based step-up，而非要求所有使用者持續錄影、提供虹膜或參加 social ceremony。

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

## 10. PoHP Receipt 設計

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

Verifier 可自行設定 policy：

```text
accept if:
    endpoint_integrity.level >= 2
    presence.level >= 2
    contribution.score >= 0.75
```

不同 trust assumptions 不應被混成無法解釋的單一分數。

---

## 11. 最值得 prototype 的三條路線

## Prototype 1 — PIH + Signed Session Receipt

**推薦優先度：最高。**

### 目的

驗證最基本研究命題：session-private、不可預測且依賴前序狀態的互動，是否能顯著提高 AI proxy 成本。

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

此 prototype 適合比較：

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

實驗條件至少包括：

- 0 次 liveness
- session start 1 次
- random 1–2 次
- risk-triggered step-up

量測上述條件對 T3 human+AI relay 成本的影響。若隨機 step-up 對攻擊成本幫助有限，應依實驗結果否決或降級此路線，而不是僅因形式上增加驗證步驟而保留。

---

## 12. 隱私與法規

台灣《個人資料保護法》要求個人資料蒐集、處理與利用不得逾越特定目的必要範圍，並規定蒐集時的告知義務。[全國法規資料庫：個人資料保護法](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021)

設計上應遵守：

- 最小資料蒐集
- biometric 不作為預設必要條件
- behavioral raw data 儘可能在端點轉成短期統計特徵
- receipt 優先保存 proof / aggregate，而非原始影像與完整行為流
- personhood 與工作 pseudonym 儘可能 unlinkable
- 高風險 evidence 使用明確 step-up consent
- 設計 retention / deletion policy

台灣個資主管機關亦有臉部、虹膜等高識別性資料相關解釋與指引；進入 biometric prototype 前應另做法遵分析：[個人資料保護委員會籌備處](https://www.pdpc.gov.tw/)

---

## 13. 主要研究結論

1. **偏好排序不是 human proof。** AI 可以模擬偏好；其價值屬於 Contribution，而非 Human-ness。
2. **沒有單一純數位認知 challenge 能穩定證明「人腦完成」。** 能力型 CAPTCHA 會隨模型進步退化。
3. **現代 CAPTCHA 已由單題能力測試轉向 anti-abuse risk assessment。** reCAPTCHA、Turnstile 與 hCaptcha 均使用背景評估、動態 challenge 或多訊號機制降低對單一視覺題的依賴。
4. **CAPTCHA 的 admission evidence 不等於持續工作證明。** 在 session 起點通過反 bot 驗證，不能推出後續工作持續由真人完成。
5. **WebAuthn / attestation 證明 endpoint / key，不證明人腦。** 但它們是 receipt integrity 的重要基礎。
6. **Liveness 提高特定時點存在真人活體的信心，不證明整段工作由人類完成。**
7. **Proof of Personhood 處理 uniqueness / Sybil 問題，不等於 work participation。**
8. **T3 Human+AI relay 是 PoHW 最重要的威脅模型。** 真人登入、AI 工作，不能由傳統 CAPTCHA 或 KYC 單獨解決。
9. **最可行的工程目標是攻擊經濟。** 目標是使成功 AI proxy 的成本、風險與操作負擔顯著高於誠實人類完成。
10. **PIH 最值得優先 prototype。** 它低隱私、低硬體依賴，可進行 A/B 與紅隊實驗，也容易被研究結果否證。
11. **PoHP 應輸出 evidence vector，而不是 Boolean。** verifier 必須知道每項 claim 的信任假設。
12. **Biometric 與 personhood 應作為高價值 step-up，而非 MVP 起點。**
13. **Privacy Pass 類架構適合用來解耦 evidence issuer 與 verifier。** 此方向可降低 PoHP credential 的可連結性與原始資料暴露。

---

## 14. 參考資料

### CAPTCHA / Anti-automation

- Google Cloud — Choose the appropriate reCAPTCHA key type: https://docs.cloud.google.com/recaptcha/docs/choose-key-type
- Google for Developers — reCAPTCHA v3: https://developers.google.com/recaptcha/docs/v3
- Google Cloud — Setup overview for websites: https://docs.cloud.google.com/recaptcha/docs/setup-overview-web
- Cloudflare — Turnstile Overview: https://developers.cloudflare.com/turnstile/
- Cloudflare — Turnstile Get started: https://developers.cloudflare.com/turnstile/get-started/
- hCaptcha — Invisible Captcha: https://docs.hcaptcha.com/invisible
- hCaptcha — Pro Features: https://docs.hcaptcha.com/pro
- hCaptcha — Developer Guide: https://docs.hcaptcha.com/

### Privacy-preserving anti-abuse tokens

- IETF RFC 9577 — The Privacy Pass HTTP Authentication Scheme: https://datatracker.ietf.org/doc/html/rfc9577
- Apple — Replace CAPTCHAs with Private Access Tokens: https://developer.apple.com/videos/play/wwdc2022/10077/

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

## 15. 後續研究問題

本報告仍留下需要 prototype 與實驗才能回答的核心問題：

1. PIH 對最新 browser-use / multimodal agent 實際能提高多少成本？
2. challenge 密度與正常工作 UX 的 Pareto frontier 在何處？
3. 哪些 task family 能同時產生 useful contribution 與高 session dependency？
4. 本機模型將 inference cost 降低後，PIH 還能依靠 latency、state complexity、credential scarcity 形成多少防禦？
5. device attestation 對 remote AI relay 的實際增益有多少？
6. 隨機 liveness 是否能有效提高 T3 成本，或主要增加正常使用者摩擦？
7. 如何讓 receipt 在不洩漏完整 transcript 的情況下證明工作量與 challenge coverage？是否需要 Merkle disclosure / zero-knowledge proof？
8. 如何定義跨 task 可比較的 Human Work Unit，而不把「花費時間」誤當成「有價值工作」？
9. 現成 reCAPTCHA / Turnstile / hCaptcha risk signal 與 PoHP 自有 evidence 結合後，是否能提供可量測的增益，或只是增加供應商依賴？
10. Privacy Pass 類 unlinkable token 能否承載 PoHP assurance level，而不讓 issuer 或 verifier 建立跨工作追蹤能力？

這些問題應作為後續實作與實驗的主要研究主軸。