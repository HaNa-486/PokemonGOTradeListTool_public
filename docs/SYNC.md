# 私人開發與公開版本同步

私人專案是持續開發的主要來源；公開專案是獨立歷史、經過整理的開源版本。這不是鏡像。不要把私人 Git remote、分支、標籤、舊提交、部署資料或實際使用者資料匯入公開倉庫。

同步工具只產生候選目錄及差異，**不會修改私人來源、不會套用到公開程式碼，也不會提交或推送**。需要 Python 3.12+ 及 Git。所有命令在公開專案執行，以下 `<private-checkout>` 替換成自己電腦上的私人專案位置；不要把實際位置寫進共享文件。

## 第一次建立基準

兩邊都必須是已提交、乾淨的 Git 工作目錄。公開專案必須保留 `.sites-runtime/` 忽略規則。

`scripts/sync-policy.json` 只列出已審核且初始內容完全相同的程式碼檔案，不接受萬用字元。資料集、說明、部署設定、UI、測試與本版專屬邏輯通常由公開版各自維護。

```sh
python scripts/sync-upstream.py init --source <private-checkout>
```

基準包含私人來源位置與版本，只存在忽略的 `.sites-runtime/sync/state.json`。不要提交或分享這個目錄。工具不會讀取私人資料庫；它比較 Git 追蹤檔的中繼資料，只有明確允許的程式碼才讀取為同步內容。

## 每次匯出

先完成私人來源的提交，再確保公開版已提交自己的修改。

```sh
python scripts/sync-upstream.py propose --source <private-checkout>
```

輸出提供一個 `proposal` ID。打開本機 `.sites-runtime/sync/proposals/<proposal>/`：

- `report.json`：可以同步的檔案、需要人工調整的來源變更、公開版修改衝突。
- `changes.diff`：只包含明確允許且沒有衝突的文字差異。
- `candidate/`：完整候選快照，可用來檢視差異；沒有 Git 歷史，不含忽略的檔案。
- `local-state.json`：檢查基準用的私人中繼資料，不得分享。

新檔案、未列入 allowlist 的修改及刪除一律列為人工審核，不會被自動加入。來源某個資料檔改動不會阻擋其他安全候選，但必須明確審閱是否需要在公開版重新設計。已列入 allowlist 的刪除會成為刪除提案，直到人工套用前都不會影響公開檔案。

公開版或社群已修改過同一個檔案時，工具保留公開版內容並列衝突。比較雙方差異後，自行合併合適的變更；不得整包覆蓋公開目錄。對非衝突的提案更新，人工套用的內容必須和候選完全一致；若要再修改，先完成這次記錄，再做獨立修改。

審查並人工套用後，執行：

```sh
python scripts/test-repository-safety.py
python scripts/test-public-sync.py
python scripts/check-public-content.py --history
npm ci --include=dev --include=optional
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
```

再提交公開版，記錄已審核的同步：

```sh
python scripts/sync-upstream.py record --source <private-checkout> --proposal <proposal>
```

如果報告有人工項目或衝突，逐項完成調整或明確決定不匯入後，增加 `--acknowledge-manual-review`。這個選項代表人工審閱已完成，不能代替審閱。它不會繞過乾淨工作目錄、候選內容、資料保護與版本檢查。

記錄成功才會前進本機基準。可分享的摘要是 `review-receipt.json`：只含隨機提案 ID、數量及結果，沒有私人路徑或提交 ID。原本的報告與其他本機檔案仍不可公開。然後依一般 PR 流程審查公開提交；工具沒有推送權限或指令。

## 社群修改與政策調整

接受公開社群 PR 後，先評估是否適合回移私人版，保留原作者與授權資訊。回移可以是人工重做或在私人版本套用公開提交；不要反向公開私人歷史。兩邊產品差異、測試與衝突由維護者處理，這是分開倉庫的主要維護成本。

allowlist 只能經公開 PR 審核修改，不能用放寬規則解決衝突。政策改變後既有基準會被拒絕。先完成當前同步；在本機備份既有忽略狀態，移走 `.sites-runtime/sync/state.json`，確保新 allowlist 每一檔案在兩邊的已提交版本相同，再重新 `init`。不相同或由公開版特別調整的檔案應保留人工維護。

若來源在提案後又提交了變更，舊提案不能記錄。重新產生提案並審閱；不要編輯本機基準來繞過檢查。工具也拒絕未提交變更、路徑越界、符號連結、Windows junction 與 Git submodule。

## 公開檢查的範圍

`check-public-content.py --history` 檢查目前可追蹤檔案、index 與本機全部可達歷史，包括刪除內容、merge 快照及 annotated tag 訊息。CI 使用完整 checkout，不提供部署秘密，不上傳產物，不執行部署；建置後建立隔離的合成 D1，以 Chromium 驗證兩個本機使用流程，測試結束會關閉自己啟動的伺服器。

檢查會阻擋已知秘密格式、私有執行資料路徑、實際站點／專案綁定、部分已知遊戲內容，以及非 synthetic 的完整 catalog pack；synthetic pack 必須符合內容 hash。輸出只有位置、類型與行號，不顯示匹配內容。它是輔助檢查，**不能證明資料的著作權、授權或完全沒有秘密**；新資料、圖片、說明與例子仍需人工授權審核。把真實遊戲資料標成 synthetic 不會讓它變成可公開內容。

合法外部 pack 可由使用者明確選取，在忽略的本機位置使用。這是使用者獨立確認資料使用權利後的選擇，不能用來繞過授權，也不會被同步或 CI 自動下載。公開版預設只有自製示範資料。

GitHub 上未抓取的 refs、舊 PR 附件、Actions 記錄、release 資產、issue 討論及其他遠端資料不在本機檢查範圍。不要把私人倉庫或它的產物搬進此專案；公開前仍需檢查遠端可見內容。
