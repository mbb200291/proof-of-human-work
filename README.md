# Proof of Human Work

> 在 AI 可以完成大量純數位認知工作的時代，研究如何對「人類確實參與並投入不可忽略工作量」建立可驗證證據。

**Proof of Human Work（PoHW，人類工作量證明）** 是一個系統安全與人機互動研究專案。它關注的問題不是 CAPTCHA 式的「這次回答看起來像不像人」，也不是宣稱能證明「完全沒有使用 AI」，而是嘗試建立一組可組合、可量測、可被攻擊驗證的證據，回答：

> 某個真實且盡可能唯一的人類，是否在指定時間區間內持續參與工作流程，並產生了具有可驗證價值的貢獻？

## 核心假設

若一個工作流程的輸入與輸出都完全數位化，而且 AI 能取得與人類相同的資訊，驗證端通常只能觀察輸入、輸出與互動紀錄，無法直接觀察中間究竟是「人腦 → 回答」、「AI → 回答」，或「AI → 人類 → 回答」。

因此，本專案不把任何單一認知任務——例如偏好排序、CAPTCHA、邏輯題、文字生成或多輪一致性——當成人類性的根證明。

研究目標改為建立不同證據面的組合：

\[
PoHP = (U, P, E, C)
\]

| 證據面 | 問題 | 可能技術 |
| --- | --- | --- |
| **U — Uniqueness** | 是否對應到一個真實且盡可能唯一的人？ | Proof of Personhood、social graph、匿名化 personhood credential |
| **P — Presence** | 該人是否在工作期間持續參與？ | 隨機 presence challenge、liveness、行為連續性 |
| **E — Endpoint Integrity** | 工作紀錄是否來自預期裝置／應用程式且未事後偽造？ | WebAuthn、device-bound key、TPM / Secure Enclave、App Attest、Play Integrity |
| **C — Contribution** | 產出的工作是否具有有效資訊量與品質？ | gold task、重測、peer validation、information gain、peer prediction |

這裡將整體概念稱為 **Proof of Human Participation（PoHP）**，作為 Proof of Human Work 的可實作核心。

## 專案目前方向

第一個 prototype 不追求生物辨識或全球「一人一帳號」。初期優先驗證一個更基本、也更容易被實驗否證的命題：

> 透過 session-private、不可預測、依賴先前互動狀態的工作流程，加上不可竄改的互動 receipt，是否能顯著提高即時 AI 代理工作的成本，同時保持合理的人類使用成本？

第一階段核心技術稱為 **Private Interaction History（PIH）**：下一個 challenge 由伺服器熵、前序互動與 session 狀態共同決定，使攻擊者難以預先批次取得任務並離線生成答案。

我們不以「AI 無法完成」作為安全目標，而以攻擊經濟性衡量：

\[
\rho = \frac{C_{successful\ AI\ proxy}}{C_{honest\ human\ completion}}
\]

其中 \(\rho\) 越高，表示成功 AI 代理相對誠實人類完成工作的成本越高。

## 文件

- [研究報告：Proof of Human Participation 設計研究](docs/research/proof-of-human-participation.md)
- [階段性實作計畫](docs/implementation-plan.md)

## 應用方向

- [Verifiable Human Coding Session：可驗證的人類程式碼編輯工作階段](docs/applications/verifiable-human-coding-session.md)  
  以 VS Code extension／受控編輯環境記錄程式碼從 workspace baseline 到最終結果的可驗證 provenance，並與 Presence、Endpoint Integrity 證據結合。此方向驗證的是「程式碼如何在受監控 session 中形成」，不宣稱能單靠 IDE 證明開發者完全沒有使用 AI。

## 初期非目標

本專案現階段**不宣稱**能做到以下事項：

- 證明認知工作百分之百由人腦完成。
- 證明使用者完全沒有 AI 輔助。
- 僅靠 WebAuthn / passkey 證明真人持續在場。
- 僅靠 liveness 證明整段工作由人類完成。
- 僅靠偏好、排序、答題正確率或行為「像人類」來證明人類性。
- 在沒有額外信任假設下，解決全球唯一身份與 Sybil 問題。

## 設計原則

1. **先定義 claim，再選證據。** 每份 receipt 都應清楚表達它實際證明的 assurance，而不是只輸出模糊的 `verified_human=true`。
2. **安全性以攻擊成本衡量。** 不依賴「目前模型還做不到」的能力差距。
3. **將 AI-assisted human 視為正式威脅模型。** 真人負責登入、AI 負責認知工作的 relay attack 必須被納入測試。
4. **隱私與摩擦採漸進式提高。** 生物辨識與高摩擦 liveness 僅應作為高風險工作的 step-up mechanism。
5. **每一層都必須可被獨立紅隊測試。** protocol 的價值來自可被量測與否證，而不是不可驗證的「像真人」分數。

## 專案狀態

目前處於 **research → protocol prototype** 階段。下一步會先完成最小 PoHP session、receipt schema、PIH challenge engine 與 adversarial benchmark，再根據實驗結果決定是否加入硬體 attestation、持續 presence 或 personhood credential。
