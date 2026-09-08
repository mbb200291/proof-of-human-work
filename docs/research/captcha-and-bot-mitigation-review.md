# 現代 CAPTCHA 與 Bot Mitigation 機制回顧

> 專案：Proof of Human Work  
> 文件角色：既有技術基線 / related work  
> 更新日期：2026-09-08

## 1. 為什麼 PoHW 必須先理解現代 CAPTCHA

Proof of Human Work（PoHW）與 CAPTCHA 表面上都涉及「人類 vs. 自動化」，但兩者實際要證明的 claim 不同。

傳統 CAPTCHA 希望回答：

> 這次互動是否比較可能來自人類，而不是自動化程式？

現代 bot mitigation 系統則逐漸改成回答：

> 這個 request / session 是否具有足夠低的濫用風險，值得被允許執行？

PoHW 想處理的問題更強：

> 某個真人是否在一段時間內持續參與工作流程，並投入不可忽略的工作量與有效貢獻？

因此 CAPTCHA 很適合作為 PoHW 的 related work 與 admission / anti-automation layer，但不能直接等同於 Proof of Human Participation，更不能單獨證明 Human Cognitive Work。

---

## 2. CAPTCHA 的安全假設如何演進

### 2.1 第一代：能力差距型 challenge

早期 CAPTCHA 的核心假設可以表示為：

\[
Ability_{human}(T) \gg Ability_{machine}(T)
\]

其中 \(T\) 是一個人類容易、機器困難的任務，例如：

- 扭曲文字 OCR
- 圖片中的物件辨識
- 選出包含紅綠燈、汽車、腳踏車等區塊
- 簡單語意辨識

典型流程：

```text
server -> challenge
human -> solve
server -> verify answer
```

這種設計最大的問題是安全性依賴「機器目前還不擅長」某項感知或認知任務。OCR、電腦視覺與多模態模型進步後，這個差距會持續縮小。

對 PoHW 的啟示是：**不要把某個 AI 暫時做不好的認知任務當成安全根。**

---

### 2.2 第二代：互動 challenge + 背景風險訊號

「I'm not a robot」checkbox 看起來像是在測試使用者能不能按一下 checkbox，但實際系統不可能依靠「點擊」本身區分 bot；自動化程式同樣能 click。

比較合理的抽象是：

```text
request / interaction
        |
        +-- browser/session signals
        +-- interaction context
        +-- network/server context
        |
        v
     risk model
        |
   +----+----+
   |         |
 low risk  high risk
   |         |
 allow    challenge / step-up
```

可見 challenge 已經從「主要驗證方式」逐步退居成高風險情況下的 step-up mechanism。

---

### 2.3 第三代：Risk scoring / invisible bot mitigation

現代 CAPTCHA 產品大量採用被動訊號與風險模型，而不是固定要求每一位使用者解題。

抽象流程如下：

```text
Signals
   |
   v
Risk Model
   |
   v
Risk Score / Classification
   |
   v
Policy Engine
   |
   +-- allow
   +-- rate limit
   +-- MFA / secondary verification
   +-- active challenge
   +-- block
```

這裡真正最佳化的目標已經更接近：

\[
P(request\ is\ legitimate \mid signals)
\]

而不是純粹的：

\[
P(actor\ is\ human)
\]

這個演進對 PoHW 非常重要：**成熟的 bot mitigation 業界已經實務上放棄把「human」壓成單一 deterministic challenge 的想法，而改採多訊號、風險分數與漸進式驗證。**

---

## 3. Google reCAPTCHA

### 3.1 現行 key 類型

Google Cloud reCAPTCHA 目前在 Web 端提供幾種主要模式：

- **Score-based key**：不顯示 CAPTCHA challenge，回傳風險分數。
- **Checkbox key**：顯示「I'm not a robot」checkbox，之後可能進一步出 challenge。
- **Policy-based challenge key**：依 configured score threshold 觸發 CAPTCHA challenge。

Google 官方目前明確將 score-based key 列為推薦選項，並指出 checkbox key 會增加使用者摩擦，但不會顯著改善準確度。

參考：

- [Google Cloud — Choose the appropriate reCAPTCHA key type](https://docs.cloud.google.com/recaptcha/docs/choose-key-type)
- [Google Cloud — reCAPTCHA keys overview](https://docs.cloud.google.com/recaptcha/docs/keys)

### 3.2 Score-based 工作方式

Score-based reCAPTCHA 的重要特徵是：系統可以部署在頁面與重要 action 上蒐集互動脈絡，再由後端建立 assessment。

典型流程：

```text
browser / app
    |
    | user action
    v
reCAPTCHA client integration
    |
    v
response token
    |
    v
application backend
    |
    | create assessment
    v
Google reCAPTCHA service
    |
    v
risk score / risk information
    |
    v
application policy
```

Google 官方也建議在多個頁面與 action 佈署 score-based key，以取得正常使用者與濫用流量在網站中的行為脈絡。

參考：

- [Google Cloud — Install score-based keys on websites](https://docs.cloud.google.com/recaptcha/docs/instrument-web-pages)
- [Google Cloud — Setup overview for websites](https://docs.cloud.google.com/recaptcha/docs/setup-overview-web)

### 3.3 它真正可以證明什麼

reCAPTCHA 比較合理的 claim 是：

> 在 Google 所觀察到的訊號與模型下，這次 action 具有某個程度的 automation / abuse risk。

它不能直接證明：

- 使用者是全球唯一真人。
- 真人在整個 session 都持續存在。
- 工作內容由真人認知產生。
- 使用者沒有使用 AI copilot。
- 真人通過驗證後沒有把工作交給 agent。

### 3.4 對 PoHW 的價值

reCAPTCHA 適合放在 PoHW 的：

- session admission
- bot risk signal
- abuse scoring
- step-up trigger

但它對 PoHP 四維 evidence 的主要貢獻有限：

| PoHP 維度 | reCAPTCHA 直接價值 |
| --- | --- |
| U — Uniqueness | 低 |
| P — Presence | 低～中，偏單點或短期互動信心 |
| E — Endpoint Integrity | 低～中 |
| C — Contribution | 無直接證據 |

---

## 4. Cloudflare Turnstile

### 4.1 設計方向

Cloudflare 將 Turnstile 定位為 smart CAPTCHA alternative。它可以不顯示傳統 CAPTCHA，而是在瀏覽器內執行一系列小型、非互動式 JavaScript challenge，收集 browser / visitor environment 相關訊號。

Cloudflare 官方列出的 challenge 類型包括：

- computational proof-of-work
- proof-of-space
- Web API probing
- browser quirks
- human behavior 相關訊號

參考：

- [Cloudflare Turnstile — Overview](https://developers.cloudflare.com/turnstile/)

這代表 Turnstile 的核心不再是「請人類解一道 AI 不會的題目」，而是透過多個弱訊號與執行環境特徵形成整體判斷。

### 4.2 基本驗證流程

```text
visitor browser
      |
      | Turnstile JavaScript
      v
non-interactive challenges
      |
      v
Turnstile token
      |
      v
application backend
      |
      | server-side validation
      v
Cloudflare Siteverify
      |
      v
accept / reject
```

Cloudflare 明確要求 token 必須由 application backend 送往 Siteverify 驗證；僅相信瀏覽器端的成功狀態不構成有效保護。

參考：

- [Cloudflare Turnstile — Get started](https://developers.cloudflare.com/turnstile/get-started/)

### 4.3 與傳統 CAPTCHA 的重要差異

Turnstile 有幾個值得 PoHW 借鏡的設計概念：

1. **多個廉價 challenge 組合，而非一個「人類專屬」challenge。**
2. **challenge 對正常使用者可以不可見。**
3. **最終由 server 驗證 token，而不是 client 自我宣告成功。**
4. **proof-of-work 本身不是 human proof，而是提高 automation 成本的一種訊號。**
5. **安全性建立在環境、行為與攻擊成本的組合，而非單一認知能力差距。**

### 4.4 它不能解決的 PoHW 問題

以下攻擊對 Turnstile 型系統尤其重要：

```text
real human
   |
   | passes / satisfies browser challenge
   v
valid session
   |
   v
AI agent performs actual work
```

這種情況對網站 bot protection 可能已經足夠安全，但對 PoHW 仍然是失敗，因為 PoHW 關心的是**後續工作期間的人類 participation**。

因此 Turnstile 最適合被視為：

> **PoHW 的 anti-automation / endpoint-risk evidence，而不是 work proof 本身。**

---

## 5. hCaptcha

### 5.1 Invisible、Passive 與 adaptive challenge

hCaptcha 目前支援：

- **Invisible**：不顯示 checkbox，必要時才顯示 challenge。
- **Passive**：不顯示主動 challenge，依被動機制與 risk score 判斷。
- **99.9% Passive**：依大量因素動態決定是否 challenge，目標是讓真正使用者遭遇主動 challenge 的比例低於約 0.1%。

官方文件明確指出 Invisible 與 Passive 是不同概念：Invisible 是沒有 checkbox；Passive 是不出 visible challenge。兩者可以組合。

參考：

- [hCaptcha — Invisible Captcha](https://docs.hcaptcha.com/invisible)
- [hCaptcha — Pro Features](https://docs.hcaptcha.com/pro)

### 5.2 Dynamic Proof of Work

hCaptcha 官方文件指出，即使沒有出現視覺 challenge，每次 request 背後仍可運作其他安全控制，包括 advanced dynamic proofs of work。

這反映出一個與 PoHW 很相近的安全思路：

> 不必讓 automation 技術上完全無法成功，只要讓大規模攻擊成本持續增加，就能產生防禦效果。

### 5.3 從 bot detection 擴展到 abuse detection

hCaptcha Enterprise 的 risk scoring 已經明確表示，它不只針對 automated abuse，也針對 human abuse；其風險模型使用大量資料點與 threat signatures 做即時分類。

參考：

- [hCaptcha — Enterprise Overview](https://docs.hcaptcha.com/ent_overview)

這是一個值得 PoHW 注意的產業趨勢：

```text
舊問題：Is this a bot?

新問題：Is this interaction abusive / fraudulent?
```

因此 modern CAPTCHA 與 anti-abuse system 的界線越來越模糊。

### 5.4 對 PoHW 的啟示

hCaptcha 最值得借鏡的是：

- passive evidence
- adaptive challenge
- attack-cost amplification
- risk-based policy
- human abuse 與 automation abuse 不必強制分成二元類別

但即使風險模型可以辨識 AI agent 或 automation pattern，仍不代表能建立密碼學式的「這份認知工作一定由真人完成」證明。

---

## 6. Friendly Captcha：Proof-of-Work CAPTCHA

### 6.1 核心設計

Friendly Captcha 採用一條和圖像 CAPTCHA 很不同的路線：讓瀏覽器在背景執行 cryptographic Proof of Work。

官方文件描述：系統會評估 visitor，並視風險決定是否要求裝置解一個具有計算成本的 challenge。使用者本身不需要辨識圖片或回答問題。

參考：

- [Friendly Captcha Developer Hub — Spam Protection](https://developer.friendlycaptcha.com/docs/v2/use-cases/spam-protection)
- [Friendly Captcha — Proof-of-Work CAPTCHA](https://friendlycaptcha.com/insights/proof-of-work-captcha/)

抽象流程：

```text
browser receives puzzle
        |
        v
local computation / PoW
        |
        v
proof / response
        |
        v
application backend
        |
        v
Friendly Captcha verification service
```

### 6.2 Proof of Work 並沒有證明 human

這個例子特別適合用來澄清「proof」的語意。

Friendly Captcha 所證明的是：

> 某個 client 為這次 request 支付了一定程度的計算資源成本。

它沒有證明：

> 計算是由真人完成。

事實上，PoW 正是由電腦完成。

因此它的安全效果來自：

\[
Cost_{mass\ abuse} = N \times Cost_{per\ request}
\]

如果正常使用者只送出少量 request，單次成本可忽略；如果攻擊者要送出數十萬、數百萬次 request，成本會被線性或更高程度放大。

### 6.3 對 PoHW 的直接啟示

這和本專案提出的攻擊經濟指標高度相關：

\[
\rho =
\frac{C_{successful\ AI\ proxy}}
     {C_{honest\ human\ completion}}
\]

PoHW 不必要求：

```text
AI success rate = 0
```

而可以追求：

```text
AI / proxy technically succeeds
but
expected attack cost > expected reward
```

Friendly Captcha 是很好的先例：**不證明 human，也可以有效阻止大規模 bot abuse。**

PoHW 可以採取相似哲學，但把被放大的稀缺資源從「純計算量」改成：

- 真人持續 presence 成本
- 即時 context relay 成本
- credential acquisition 成本
- session continuity 成本
- 人類 operator 配合成本
- failed-session expected loss

---

## 7. 現代 CAPTCHA 常用的訊號類型

商業產品通常不公開完整模型或所有 feature，但從官方文件與公開架構可整理出幾個常見 evidence family。

### 7.1 Network / request context

例如：

- IP / network reputation
- ASN / proxy / VPN / hosting characteristics
- request velocity
- geographic anomaly
- known abuse pattern

這些訊號主要回答：「這個來源像不像攻擊流量？」

它們不直接證明人類存在。

### 7.2 Browser / execution environment

例如：

- JavaScript execution
- Web API availability / behavior
- browser quirks
- automation environment anomalies
- proof-of-work / proof-of-space

這類訊號提高 headless automation、偽造 client 或大規模 bot infrastructure 的成本。

### 7.3 Interaction / session context

例如：

- action sequence
- session history
- page transitions
- interaction timing
- repeated failures
- behavior continuity

它們提供比單一 click 更完整的 session evidence，但仍然可能被 sophisticated agent 模擬。

### 7.4 Challenge result

例如：

- image challenge
- checkbox escalation
- active puzzle
- computational puzzle

challenge result 只是多訊號中的一部分，不應被視為 deterministic human certificate。

### 7.5 Reputation / historical context

大型 anti-abuse provider 可以利用跨 request 或跨 session 的歷史資料建立風險模型。

這類訊號的優勢是準確度可能較高；代價則可能包含：

- privacy
- linkability
- vendor dependency
- cold-start 問題
- 對新使用者或特殊環境的 false positive

---

## 8. Server-side verification 是共同安全邊界

reCAPTCHA、Turnstile、hCaptcha、Friendly Captcha 都有一個共同模式：

```text
client executes mechanism
        |
        v
client receives token / response
        |
        v
application server
        |
        v
provider-side verification
```

不能只依賴：

```text
client says: verification succeeded
```

因為 client 是攻擊者可以控制的環境。

對 PoHW 而言，這個原則應直接延伸成：

- challenge 由 server nonce / entropy 約束
- transcript root 由 server 驗證
- receipt 由可信 issuer 簽章
- client-side score 不能自行決定 assurance level
- replay protection 必須在 verifier / server 端執行

---

## 9. 現代 CAPTCHA 的共同限制

### 9.1 Human + AI relay

最重要的 PoHW 攻擊仍然存在：

```text
human passes anti-bot / liveness
        |
        v
AI performs cognition
        |
        v
human or automation submits answer
```

CAPTCHA 的 security goal 通常沒有要求阻止這種情況，因此不能把「通過 CAPTCHA」當作 work attribution。

### 9.2 CAPTCHA solving farm / human farm

即使 challenge 對 AI 很難，也可以把 challenge relay 給便宜的人力執行。

因此：

> Human solvability 並不等於 Sybil resistance，也不等於 personhood uniqueness。

### 9.3 Browser automation 能模擬行為

滑鼠軌跡、等待時間、typing cadence 等 behavioral feature 都可以被生成或 replay。

這些訊號適合作為 risk model feature，但不適合作為單獨的 cryptographic proof。

### 9.4 AI 能力進步造成 capability-based challenge 老化

只要 challenge 的主要 security assumption 是：

```text
AI cannot solve task T
```

就必須預期它的安全半衰期有限。

PoHW 應避免依賴這種 assumption 作為核心 protocol guarantee。

---

## 10. 四種現有方案比較

| 系統 | 主要方法 | 主要安全目標 | 使用者摩擦 | 成本放大 | 是否直接證明真人持續工作 |
| --- | --- | --- | ---: | ---: | --- |
| Google reCAPTCHA | score-based risk model + optional challenge | automation / abuse risk | 低～中 | 中 | 否 |
| Cloudflare Turnstile | browser/environment micro-challenges + token validation | bot / browser automation mitigation | 低 | 中 | 否 |
| hCaptcha | passive risk scoring + adaptive challenge + dynamic PoW | bot 與 abuse mitigation | 低～中 | 中～高 | 否 |
| Friendly Captcha | background proof-of-work + risk signals | 提高大規模 automated abuse 成本 | 低 | 高，尤其大量 request | 否 |

這些系統彼此技術路線不同，但共同點非常一致：

> **它們主要在管理 request risk 與 automation cost，而不是產生「這份工作由人類認知完成」的證明。**

---

## 11. 映射到 PoHP 四維 evidence

本專案目前使用：

\[
PoHP = (U, P, E, C)
\]

把上述方案映射後可以看到 CAPTCHA 的角色邊界：

| 技術 | U — Uniqueness | P — Presence | E — Endpoint Integrity | C — Contribution |
| --- | ---: | ---: | ---: | ---: |
| 視覺 CAPTCHA | 0 | 1 | 0 | 0 |
| reCAPTCHA risk score | 0 | 1–2 | 1 | 0 |
| Turnstile | 0 | 1–2 | 1–2 | 0 |
| hCaptcha | 0 | 1–2 | 1–2 | 0 |
| Proof-of-Work CAPTCHA | 0 | 0–1 | 1 | 0 |

這裡的數字不是產品安全認證，只是用 PoHP claim 對技術能力做相對映射。

最大缺口仍然是：

- U：CAPTCHA 通常不解決一人一身份。
- P：只能建立短期或局部 presence / legitimacy confidence。
- C：完全不判斷工作成果是否具有價值。

因此 CAPTCHA 最合理的系統位置是：

```text
                 Proof of Human Work
                         |
        +----------------+----------------+
        |                |                |
        v                v                v
 admission / risk     participation    contribution
        |                |                |
 CAPTCHA /             PIH /           audit /
 Turnstile /           liveness /      peer validation /
 hCaptcha              continuity      information gain
```

---

## 12. 對 PoHW protocol 設計的具體啟示

### 12.1 不要設計「更難的 CAPTCHA」

PoHW 第一版若只是發明一個 AI 暫時不容易解的 puzzle，會重走早期 CAPTCHA 的路線。

PIH 的價值應放在：

- session dependency
- unpredictability
- relay cost
- continuity cost
- auditability

而不是「題目智力難度」。

### 12.2 採用 risk-based step-up

現代 CAPTCHA 已經證明所有人固定接受高摩擦 challenge 並非必要。

PoHW 可以採：

```text
low-risk / low-reward
    -> signed session + PIH

medium-risk
    -> stronger endpoint evidence + random audit

high-risk / high-reward
    -> randomized presence / liveness + personhood
```

### 12.3 把多個弱證據組合，而不是尋找單一魔法訊號

滑鼠軌跡、WebAuthn、liveness、PIH、attestation、peer validation 各自都不完整，但可以形成 evidence vector。

這與 CAPTCHA 從單一 puzzle 轉向 risk model 的演進一致。

### 12.4 Proof-of-Work 的真正價值是經濟學，而不是 human-ness

Friendly Captcha 特別值得納入 PoHW threat model：只要某種機制能讓攻擊成本隨規模快速上升，它就可能有安全價值，即使那個 mechanism 完全由機器完成。

PoHW 可以把同樣概念套到 human relay：

\[
ExpectedReward_{attack} - ExpectedCost_{attack} < 0
\]

這可能比尋找「AI 絕對無法做的任務」更耐久。

### 12.5 CAPTCHA 可以成為 PoHW 的 baseline attacker gate

後續 prototype 應至少測試：

1. 無 CAPTCHA / 無 bot mitigation。
2. 現成 Turnstile / reCAPTCHA 類 admission gate。
3. admission gate + PIH。
4. admission gate + PIH + endpoint attestation。
5. admission gate + PIH + randomized presence。

如此才能測量 PoHW 新增的機制到底提供多少 marginal security gain，而不是把既有 CAPTCHA 的效果誤算成 PoHW 的貢獻。

---

## 13. 研究結論

1. **傳統 CAPTCHA 依賴 human-machine capability gap；這條安全假設會隨 AI 能力進步退化。**
2. **現代 CAPTCHA 已經轉向 risk scoring、browser/environment signal、adaptive challenge 與攻擊成本管理。**
3. **Google reCAPTCHA 的 score-based 模式顯示主流方向已從「每人解題」轉向「每個 action 做 risk assessment」。**
4. **Cloudflare Turnstile 顯示多個非互動式 browser challenge 可以取代單一視覺 CAPTCHA；proof-of-work 只是其中一種 signal。**
5. **hCaptcha 顯示 passive risk scoring、adaptive challenge 與 dynamic PoW 可以共同形成 attack-cost amplification。**
6. **Friendly Captcha 是重要對照：它根本不需要證明 human，仍可透過 PoW 有效提高大規模 abuse 成本。**
7. **CAPTCHA 通常不解決 uniqueness、長時間 participation 或 contribution quality。**
8. **對 PoHW 而言，CAPTCHA 應定位為 admission / anti-automation layer，而不是 Human Work Proof。**
9. **PoHW 最值得繼承的不是 CAPTCHA 題型，而是現代 bot mitigation 的三個思想：多訊號 evidence、risk-based step-up、attack economics。**
10. **Human + AI relay 仍是 CAPTCHA 無法直接處理、但 PoHW 必須正面處理的核心威脅。**

---

## 14. 主要官方資料來源

### Google reCAPTCHA

- [Choose the appropriate reCAPTCHA key type](https://docs.cloud.google.com/recaptcha/docs/choose-key-type)
- [reCAPTCHA keys overview](https://docs.cloud.google.com/recaptcha/docs/keys)
- [Install score-based keys on websites](https://docs.cloud.google.com/recaptcha/docs/instrument-web-pages)
- [Setup overview for websites](https://docs.cloud.google.com/recaptcha/docs/setup-overview-web)

### Cloudflare Turnstile

- [Turnstile Overview](https://developers.cloudflare.com/turnstile/)
- [Turnstile Get Started](https://developers.cloudflare.com/turnstile/get-started/)

### hCaptcha

- [Invisible Captcha](https://docs.hcaptcha.com/invisible)
- [Pro Features / 99.9% Passive](https://docs.hcaptcha.com/pro)
- [Enterprise Overview](https://docs.hcaptcha.com/ent_overview)

### Friendly Captcha

- [Developer Hub — Introduction](https://developer.friendlycaptcha.com/docs/v2)
- [Spam Protection / Proof of Work](https://developer.friendlycaptcha.com/docs/v2/use-cases/spam-protection)
- [Verify the response](https://developer.friendlycaptcha.com/docs/v2/getting-started/verify)
- [Proof-of-Work CAPTCHA](https://friendlycaptcha.com/insights/proof-of-work-captcha/)
