# PoHW Coding Monitor

[繁體中文](README.md) · [English](README.en.md)

[![VS Code Extension CI](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml/badge.svg?branch=main)](https://github.com/mbb200291/proof-of-human-work/actions/workflows/vscode-extension.yml)
[![Version](https://img.shields.io/badge/Coding%20Monitor-v0.3.3-blue)](https://github.com/mbb200291/proof-of-human-work)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**PoHW Coding Monitor** 是追蹤程式碼編輯來源的 VS Code 外掛。透過編輯與存檔事件記錄程式碼形成過程，計算人類編輯行為特徵分數，並為 Git Commit 產生可驗證的簽署紀錄。

## 功能

- **編輯監控**：記錄文件變更與存檔，追蹤目前程式碼區段的來源。
- **編輯證據評分**：提供 Human Editing Evidence Score、Monitored Coverage 與 Unverified 區段；相同內容的程式碼搬移可繼承來源紀錄。
- **Commit 證據**：使用 Ed25519 簽署對應 Git Commit 的 Receipt，獨立保存至 `pohw-evidence` 分支。
- **GitHub 徽章**：由 GitHub Actions 驗證簽章與程式碼內容，在 `pohw-badges` 發布分數徽章及詳細報告。
- **本機報告**：在 VS Code 唯讀 Webview 檢視各檔案評分與監控紀錄。

## 安裝

需求：**VS Code 1.90+**。目前提供 VSIX，尚未發布至 VS Code Marketplace。

**[下載最新版 VSIX](https://github.com/mbb200291/proof-of-human-work/releases/download/continuous/pohw-coding-monitor.vsix)** · [查看 Continuous Release](https://github.com/mbb200291/proof-of-human-work/releases/tag/continuous)

下載後，在 VS Code 執行 **Extensions: Install from VSIX...** 安裝。

固定下載連結由 GitHub Actions 在每次 `main` Commit 通過測試及打包後自動更新。失敗的建置不會取代現有版本。

## 基本使用

開啟單一專案資料夾，在 Command Palette（macOS：`Cmd+Shift+P`；Windows/Linux：`Ctrl+Shift+P`）執行：

| 指令 | 用途 |
| --- | --- |
| `PoHW: Start Monitoring` | 開始記錄編輯 |
| `PoHW: Show Provenance Report` | 顯示分數、涵蓋率與來源報告 |
| `PoHW: Stop Monitoring` | 停止監控並保存本機資料 |
| `PoHW: Enable GitHub Badge` | 初始化或更新目前 GitHub 專案的驗證設定 |
| `PoHW: Sync Commit Evidence` | 手動補齊或重試 Commit 證據同步 |

監控期間正常編輯、存檔即可。重新啟動 VS Code 後，需再次執行 Start Monitoring。

## GitHub 徽章

在要啟用的 **Git 儲存庫根目錄**執行 `PoHW: Enable GitHub Badge`，選擇實際的 GitHub 預設分支（例如 `main` 或 `dev`）。

首次設定會產生公鑰、驗證器、GitHub Actions 工作流程，並在專案 README 加入徽章。**首次設定檔須由使用者正常 Commit、Push 一次**，同時開啟 GitHub Actions 的寫入權限。往後使用既有 Git 工作流程：

```text
Start Monitoring → 編輯、存檔 → Stop Monitoring
                             ↓
                    正常 git commit
                             ↓
              PoHW 簽署並推送 pohw-evidence
                             ↓
                     正常 git push
                             ↓
                 GitHub Actions 驗證
                             ↓
                   README 顯示徽章
```

PoHW 不會替使用者提交或推送程式碼分支，也不會修改原有的 Staging Area。外掛啟用期間約每 5 秒檢查新的本機 Commit；需要補同步時可執行 `PoHW: Sync Commit Evidence`。

## 指標與安全性

| 指標 | 定義 |
| --- | --- |
| **Human Editing Evidence Score** | 已監控程式碼的 Rule-based 編輯行為分數 |
| **Monitored Coverage** | 目前程式碼具有編輯來源紀錄的比例 |
| **Unverified** | 缺乏可歸屬編輯紀錄的程式碼；不計為 0% 人類 |

分數尚未經統計校準，**不代表人類撰寫機率**。Receipt 為本機金鑰簽發的自我聲明證據；GitHub Actions 驗證簽章與 Commit 內容一致性。現階段無法排除模擬編輯操作或外部 AI 輔助。

外掛會將追蹤中的程式碼內容與統計資料保存在本機 VS Code Extension 儲存空間；公開 Receipt 與徽章不包含原始程式碼。

## 開發

需求：Node.js 20+、npm。

```bash
git clone https://github.com/mbb200291/proof-of-human-work.git
cd proof-of-human-work/extension
npm install
npm test
npm run package
```

本機偵錯：在 VS Code 開啟 `extension/`，按 **F5** 啟動 Extension Development Host。

進階設定與驗證流程請參閱 [Extension 文件](extension/README.md)。

## 授權

[MIT](LICENSE)
