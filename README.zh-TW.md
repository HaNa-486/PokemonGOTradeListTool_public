# 交換帳本 · Trade Ledger

**支援私人交換圈、共用庫存、雙方確認及歷史更正的多使用者交換帳本。**

[English](README.md) · [架構](docs/ARCHITECTURE.md) · [作品集導覽](docs/PORTFOLIO.md) · [驗證紀錄](docs/VERIFICATION.md)

同一筆供給分享到多個圈，不能變成多份庫存；兩人同時預留最後一件，不能都成功；交換分批完成，也不能靠手改數字抹去歷史。這些是本專案要處理的核心問題。

這個 repo 是可獨立運作的作品集與社群版本，內附 **6 種原創虛構物種及合成示範帳號**，不包含真實遊戲圖鑑、挖掘翻譯、美術素材、私人帳本或正式網站的部署綁定。

## 本機操作示範

示範使用實際應用程式 API，以及以 SQLite 保存資料的本機 D1。兩個隔離瀏覽器 context 代表兩位合成使用者，預先建立的測試 session 僅供本機操作；**這不是 Google／ChatGPT 真人登入驗證，也不是正式登入旁路**。

<p>
  <img src="docs/screenshots/demo-mobile.png" width="260" alt="虛構資料的交換帳本手機示範" />
  <img src="docs/screenshots/demo-desktop.png" width="640" alt="合成使用者的交換帳本桌面示範" />
</p>

本專案沒有承諾免登入的公開網站 demo。截圖與本機操作使用合成資料，驗證範圍見 [VERIFICATION.md](docs/VERIFICATION.md)。

## 快速開始

需要 **Node.js 24、npm、Python 3.12 與 Git**；首次安裝依賴與瀏覽器可能需要數分鐘。本機示範不需要雲端帳號或 OAuth 憑證。

```sh
git clone https://github.com/HaNa-486/PokemonGOTradeListTool_public.git
cd PokemonGOTradeListTool_public
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run demo:setup
```

在一個終端機保持伺服器運行：

```sh
npm run demo:start
```

在另一個終端機執行：

```sh
npm run demo:open
```

這會在 `https://127.0.0.1:8787` 開啟兩個隔離的示範身分。操作時保持該終端機開啟；回到終端機按 Enter 會關閉兩個視窗。接著依 [本機操作導覽](docs/PORTFOLIO.md#local-walkthrough) 瀏覽、提案、預留並完成交換。Linux 可能需要額外的 Chromium 系統函式庫，請依 Playwright 的作業系統需求安裝。

`demo:setup` 只供全新 checkout 初始化一次；只要已有任何 demo state 或 session 檔案就會拒絕。它只建立兩個有效 24 小時的身分，不會預先建立圈或庫存；期間再次使用只需執行 `demo:start`、`demo:open`。過期後的處理見部署文件。不要繞過檢查、刪除需要保留的資料，或改成操作正式庫。沒有測試 session 的一般瀏覽器仍會顯示未登入，這是預期行為。詳細步驟見 [DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 已實作的功能與界線

| 範圍 | 行為 | 界線 |
|---|---|---|
| 私人圈與代管 | 邀請、成員核准、角色及明確範圍的代管 | 每次操作由後端重新判斷權限 |
| 供需管理 | 完整條件、分享、搜尋與圈友瀏覽 | 跨圈分享共用同一筆 ID、數量與進度 |
| 配對與主動提案 | 條件配對及雙向內容修訂 | 對方沒有需求也可收到提案 |
| 預留 | 雙方同意同一版本後原子預留 | 修改會撤銷舊同意；不足時整筆失敗 |
| 完成與更正 | 部分回報、確認扣帳及保留歷史的更正 | 單方回報不直接扣帳 |
| 可見性 | 個人隱藏／恢復，以及獨立的圈管理功能 | 管理員撤下明確影響全圈 |
| 備份 | 個人匯出、驗證匯入、限維運備份與隔離還原 | 本機還原不等於正式災難復原已驗證 |
| 介面 | 手機版型、供需分色、系統／深／淺色 | 實體手機與輔助科技仍需另行驗收 |
| 登入 | Sites 身分介接與 Google OIDC 程式 | 真實憑證及部署信任邊界須獨立驗證 |

UI 主要使用繁體中文；部分欄位沿用原交換情境的領域詞彙，但內附資料全部是虛構示範。

## 工程重點

- **共用庫存：** 分享只決定誰能看見，不複製帳本。
- **原子寫入：** D1 batch 內包含版本閘門、資料、分享、audit 及重試收據；失敗整批回滾。
- **安全重試：** 同一識別碼不能提交不同內容；重播舊請求也會重新確認目前權限。
- **未知值明確：** UNKNOWN、NONE、false 與 ANY 分開，不能只靠編號合併。
- **同意與版本綁定：** 新版本需重新同意；完成、更正各有可追溯紀錄。

全站 epoch 讓一致性規則容易驗證，但會產生寫入競爭。本專案沒有宣稱大規模正式吞吐量；取捨見 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 驗證與限制

```sh
npm run check:repository
npm run test:repository
python scripts/check-public-content.py --history
npm run typecheck
npm test
npm run build
```

完成 demo 初始化並啟動伺服器後，可執行 `npm run demo:qa` 驗證合成使用者流程。[CI](.github/workflows/ci.yml) 執行程式與依賴檢查，不部署、不取得正式資料，也不使用正式 secrets。流程檔存在或本機通過，都不能當成 GitHub 已通過的證據；實際結果見 [驗證紀錄](docs/VERIFICATION.md)。

仍待驗證或實作的項目包含真人 provider 登入與正式環境、跨 provider 安全帳號綁定、實體裝置與無障礙、正式容量及災難還原。獨立持久化的計畫 `draft`／`disputed` 狀態尚未實作；互補配對不會一次算出所有未載入頁的完整集合。

## 貢獻、授權與作品集

原創程式、文件、測試及虛構示範目錄採 [MIT](LICENSE)；第三方部分保留[各自聲明](THIRD_PARTY_NOTICES.md)。MIT 不授予第三方商標或遊戲素材權利。自備目錄需另外記錄來源與可使用範圍；資料包 ID、版本、類型、schema 版本及內容雜湊會綁定帳本，即使一般資料更新也需要受控遷移或新資料庫，見 [DATASETS.md](docs/DATASETS.md)。

本專案非 Pokémon、Nintendo、Niantic、Scopely 或 OpenAI 官方產品，也未宣稱獲得其認可。repo 名稱反映原始用途；公開示範不包含真實寶可夢資料集。

本專案使用 AI 協作開發：擁有者提供產品需求、使用回饋與發布決策，Codex 協助實作、測試及文件。作品集呈現可解釋的取捨與可重現證據，不將 AI 產出或本機模擬宣稱為全部手寫或真人驗收。

[貢獻指南](CONTRIBUTING.md) · [安全政策](SECURITY.md) · [作品集導覽](docs/PORTFOLIO.md) · [部署](docs/DEPLOYMENT.md) · [備份](docs/BACKUP.md) · [維護同步](docs/SYNC.md)
