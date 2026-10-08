# Proof of Human Work (PoHW)

**語言：** [繁體中文](README.md) | [English](README.en.md)

[![VS Code Extension CI](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml/badge.svg?branch=main)](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml)
[![Coding Monitor Version](https://img.shields.io/badge/Coding%20Monitor-v0.3.2-blue)](https://github.com/mbb200291/proof-of-human-work)
![License](https://img.shields.io/badge/license-MIT-green)

> 研究如何為人類在數位工作中的實際參與建立可追溯、可驗證的證據。

**Proof of Human Work（PoHW，人類工作量證明）** 是系統安全與人機互動研究專案。第一個可用原型 **PoHW Coding Monitor** 是 VS Code 外掛：記錄程式碼的編輯歷程、用 Rule-based 規則評估人類編輯行為特徵，並將簽署證據綁定 Git Commit，透過 GitHub Actions 驗證與 README Badge 展示結果。

> **重要界線：** Human Editing Evidence Score 是**啟發式行為分數**，不是「程式碼由人類撰寫的機率」。簽章與 CI 能檢查 Receipt 對應的程式碼 Commit，但無法證明開發者完全沒有使用 AI。

## 功能與目前狀態

| 功能 | 狀態 |
| --- | --- |
| VS Code 啟動／停止監控、文件變更與存檔記錄 | 已實作 |
| Rule-based Human Editing Evidence Score | 已實作，尚未校準 |
| Monitored Coverage、Unverified 區段、程式碼搬移繼承來源 | 已實作（有限制） |
| 唯讀的 VS Code Webview 報告 | 已實作 |
| Ed25519 Signed Receipt 綁定 Git Commit SHA | 已實作 |
| 獨立 `pohw-evidence` 分支，自動產生／推送證據 | 已實作，需 Git 認證 |
| GitHub Actions 驗證、README Badges | 已實作，需在各專案初始化 |
| 真正的人類撰寫機率與 95% 信賴區間 | 尚未提供 |
| 防篡改可信端點、硬體鍵盤驗證、完整跨 Commit 區段追溯 | 尚未提供 |

詳見 [Coding Monitor 技術與使用文件](extension/README.md)、[應用方向設計](docs/applications/verifiable-human-coding-session.md)。

## 1. 安裝 VS Code 外掛

需求：**VS Code 1.90+**。原型尚未發布至 VS Code Marketplace，可安裝 GitHub Actions 打包的 VSIX，或自行編譯。

**安裝 VSIX：**

1. 進入 [VS Code Extension CI](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml)，選擇最新成功執行，從 **Artifacts** 下載 `pohw-coding-monitor-vsix` 並解壓縮。
2. VS Code 執行 **Extensions: Install from VSIX...**，選取 `.vsix` 安裝。
3. 若 GitHub Artifact 已到期，可使用下面的原始碼打包方式。

**本機開發／測試（Node.js 20+、npm）：**

```bash
git clone https://github.com/mbb200291/proof-of-human-work.git
cd proof-of-human-work/extension
npm install
npm test
npm run package  # 輸出 .vsix
```

也可以直接在 VS Code 開啟 `extension/` 資料夾，按 **F5** 啟動 Extension Development Host，再於新視窗開啟測試專案。

## 2. 開始監控與查看分數

在 VS Code 開啟**單一 workspace 資料夾**，透過 Command Palette（macOS：Cmd+Shift+P；Windows/Linux：Ctrl+Shift+P）：

1. 執行 **PoHW: Start Monitoring**：讀取 workspace 初始狀態，開始記錄編輯。
2. 正常編輯、存檔。外掛監聽文件變更事件，並於儲存時記錄 Save 事件。
3. 執行 **PoHW: Show Provenance Report**：在唯讀 Webview 查看 Score、Coverage 與檔案來源；不會出現 `Untitled` 未儲存文件。
4. 執行 **PoHW: Stop Monitoring**：結束本次監控，保留結果。下次重新 Start 時，內容一致的既有來源證據可以繼承。

| Command Palette | 功能 |
| --- | --- |
| **PoHW: Start Monitoring** | 開始監控目前 workspace |
| **PoHW: Stop Monitoring** | 停止監控，保存資料 |
| **PoHW: Show Provenance Report** | 開啟唯讀報告 |
| **PoHW: Enable GitHub Badge** | 初始化或升級某個 GitHub 專案的 Badge |
| **PoHW: Sync Commit Evidence** | 手動同步目前 Git HEAD 的證據／重試 Push |
| **PoHW: Publish Signed Receipt** | 相容舊指令，目前是 Sync 的別名 |

**指標語意：**

- **Human Editing Evidence Score**：針對「已監控且可歸屬來源」的程式碼，計算 Rule-based 編輯行為分數。
- **Monitored Coverage**：目前程式碼有多少比例具備監控來源記錄。計數單位為非空白 UTF-16 code units。
- **Unverified**：監控前的檔案、停止期間的修改、外部寫檔或無法與 Git Commit 內容對應的區段。**Unverified 不等於 AI，亦不等於 0% Human。**
- Coverage 為 0% 時，Human Editing Evidence Score 顯示 **N/A**。目前沒有統計有效的 95% 信賴區間。

監控不會在 VS Code 重啟後自動恢復；需要重新 Start。外掛**不能**從既有 VS Code Timeline 回填完整編輯歷史。

## 3. 第一次為自己的 GitHub 專案啟用 Badge

**只有啟用 GitHub Badge 才會修改專案設定。** 單純 Start Monitoring 不會自動在 README 加 Badge。

1. 在 VS Code 開啟欲啟用專案的**Git 儲存庫根目錄**，確保 `origin` 指向 GitHub。
2. 執行 **PoHW: Enable GitHub Badge**，指定 GitHub 儲存庫的**實際 Default Branch**（例如 `main` 或 `dev`）。
3. 外掛建立／更新 `.pohw/public-key.pem`、`.pohw/proof.js`、`.pohw/verify.cjs`、`.github/workflows/pohw-verify.yml`，並在 `README.md` 插入 Badge 區塊。
4. **只有首次初始化（或升級設定檔）時，需照正常開發程序 Commit 並 Push 這些設定檔**，才能讓遠端 GitHub Actions 啟用。
5. GitHub Repository **Settings → Actions → General → Workflow permissions** 須允許 Actions 寫入儲存庫，並避免規則封鎖 `pohw-badges`。外掛自動推送 `pohw-evidence` 需要本機有對 `origin` 的正常 Git Push 權限。

私鑰保存在本機 VS Code Extension 的 `globalStorage`，不會 Commit 到專案。請安全備份；遺失私鑰後要明確輪替專案公鑰才能繼續發行證據。

### 日常使用：不必再替 PoHW 額外 Commit

```text
PoHW: Start Monitoring → 編輯與存檔 → PoHW: Stop Monitoring
                                ↓
                   你照常 git commit 程式碼
                                ↓
                 PoHW 自動偵測新本機 Commit
                                ↓
            簽署 Receipt → 建立／Push pohw-evidence
                                ↓
                   你照常 git push 程式碼
                                ↓
                   GitHub Actions 驗證
                                ↓
               更新 pohw-badges → README Badges
```

已初始化專案且 VS Code 外掛啟用時，PoHW 約每 **5 秒**檢查新的本機 Git Commit。**它不會自動替你提交或推送原本的程式碼。** 產生 Evidence Commit 使用暫時的 Git Index 和底層 Git 物件操作，不會修改你的 HEAD、Staging Area、Unstaged／Untracked 檔案。部分 Staged 而無法與監控資料一致的區段會保守標為 Unverified。

| 分支 | 角色 |
| --- | --- |
| `main` / `dev`（Default Branch） | 使用者程式碼與初次設定檔 |
| `pohw-evidence` | 以 `receipts/<commit-sha>.json` 保存簽署證據，無須 Merge 回程式碼分支 |
| `pohw-badges` | CI 驗證後發布 `summary.json` 與 `REPORT.md`，供 README Badges 與詳細報告讀取 |

若在 VS Code 關閉期間 Commit、在 GitHub 網頁完成 Merge，或證據 Push 失敗，先在本機取得欲驗證的 Commit，再執行 **PoHW: Sync Commit Evidence**。CI 在程式碼 Push 時最多等待約 90 秒取得同 SHA 的證據；逾時可於證據同步後重跑 Actions。

**停用自動推送證據：** 在 VS Code Settings 將 `pohw.evidenceAutoPush` 設為 `false`，之後可手動執行：

```bash
git push origin refs/pohw/evidence:refs/heads/pohw-evidence
```

### 手動驗證 Receipt

本機 HEAD 必須對應到欲檢查的 Commit：

```bash
git fetch origin pohw-evidence
sha=$(git rev-parse HEAD)
git show "FETCH_HEAD:receipts/$sha.json" > /tmp/pohw-receipt.json
node .pohw/verify.cjs . /tmp/pohw-receipt.json /tmp/pohw-summary.json
```

驗證器以 **Git Commit Tree** 比對檔案與簽章，不會把尚未 Commit 的工作目錄內容當成受驗證程式碼。

## 4. 常見問題與排除方式

| 現象 | 原因與處理 |
| --- | --- |
| Badge 顯示 `resource not found` | 尚未成功發布 `pohw-badges/summary.json`；檢查 Actions 的 verify／publish 工作 |
| Badge 顯示 `no status` | 確認 workflow 已提交到 GitHub 真正的 Default Branch，README 連結分支也一致 |
| CI 顯示 missing evidence | `pohw-evidence` 沒有對應 SHA 的 Receipt；於相同 HEAD 執行 Sync，再重新執行 Workflow |
| 首次建立 Badge 分支失敗 | 使用 **v0.3.1+** 重新執行 Enable GitHub Badge 並更新 Workflow；確認 Actions 寫入權限 |
| Human Score = N/A、Coverage = 0% | 目前程式碼無可歸屬的受監控編輯區段，或 Commit 與本機監控內容不一致 |
| 切換分支後來源變成 Unverified | checkout／pull／merge 造成的變更不會直接當成人類手動編輯 |
| 曾安裝 v0.2 舊版 Badge | 重新執行 Enable GitHub Badge 升級模板；舊 `.pohw/receipt.json` 不再用於新制，可在一般 Commit 移除 |
| 如何修改 Default Branch 設定？ | 重新執行 Enable GitHub Badge 更新 README 連結；Badge 數值仍以 GitHub **實際** Default Branch 發布為準 |

**徽章點擊行為：** Coding Monitor 版本徽章連到 [PoHW 專案首頁](https://github.com/mbb200291/proof-of-human-work)；Editing Score 與 Monitored 連到各專案 CI 產生的 `pohw-badges/REPORT.md`，內含分數、監控涵蓋率、Commit SHA、原始碼雜湊與簽章證據連結；Receipt Verification 連到各專案的 GitHub Actions。

Badge 只顯示**最近一次成功驗證的統計結果**；當新 Commit 驗證失敗時，舊數值可能仍顯示，因此應搭配 Verification Workflow 狀態與報告 Commit SHA 判讀。

## 5. 評分方法、安全性及隱私界線

Rule-based 原型評估編輯大小、增量形成、反覆修改、刪除／重寫及原樣搬移等訊號，並把來源標籤附著於目前仍存在的文字區段。原型測試覆蓋四類模式：AI Agent 大量產生、手寫搭配 Stack Overflow 貼上、手寫架構搭配 AI 函式貼上、手寫後搬移程式碼。**測試通過代表規則符合預期樣例，不代表 AI 一定能被辨識。**

- 可以模擬人類逐字編輯的 Agent，以及人類從另一台裝置閱讀 AI 輸出再輸入，仍可避開這類監控。
- 簽章由使用者本機金鑰簽出，是 **self-attested evidence**。它能驗證內容一致與歸屬於既定金鑰，無法證明輸入者的認知來源。
- 本機 VS Code Extension 儲存空間會保留被追蹤的**完整程式碼文字**及統計資訊；敏感專案使用前請評估資料保存政策。公開的 Receipt／Badge 不需上傳原始程式碼。
- 目前僅支援單一 workspace 資料夾、允許清單內的文字格式；預設每檔上限 512 KiB、最多 2,000 個檔案，可設定 `pohw.maxFileBytes`、`pohw.maxFiles`、`pohw.include`、`pohw.exclude`。
- 尚未實作實體鍵盤 attestation、端點防竄改、真人持續在場 challenge、可信賴的人類比例機率或 95% 信賴區間。

## 6. 研究背景

PoHW 長期目標是將四個不同證據面組合，而非輸出無法解釋的 `verified_human=true`：

| 證據 | 問題 |
| --- | --- |
| **U — Uniqueness** | 是否對應到真實且盡可能唯一的人？ |
| **P — Presence** | 該人在工作期間是否持續參與？ |
| **E — Endpoint Integrity** | 記錄是否由預期裝置／程式產生，且難以事後偽造？ |
| **C — Contribution** | 工作成果是否具有可驗證價值？ |

PIH（Private Interaction History）、持續 presence、硬體 attestation 仍是後續研究方向，**未整合進目前 VS Code 原型**。

- [Proof of Human Participation 研究報告](docs/research/proof-of-human-participation.md)
- [階段性實作計畫](docs/implementation-plan.md)
- [Verifiable Human Coding Session 應用設計](docs/applications/verifiable-human-coding-session.md)
- [VS Code Extension 進階使用文件](extension/README.md)

## License

[MIT](LICENSE)