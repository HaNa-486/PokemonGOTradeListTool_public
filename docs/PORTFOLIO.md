# Portfolio walkthrough

This project demonstrates how a small product can treat permissions, concurrent inventory, and human confirmation as first-class requirements. The fictional catalog keeps the public example independently reviewable without redistributing a real game's data.

## Local walkthrough

Follow [DEPLOYMENT.md](DEPLOYMENT.md) to build, initialize, and start the local demo. `npm run demo:open` opens **Alex · 示範甲** and **River · 示範乙** in isolated browser contexts. Use the account panel to distinguish the windows. Keep its terminal open; press Enter there only when you want both windows closed. The interface is primarily Traditional Chinese.

A fresh demo starts with users only, so create the circle and data yourself:

1. **Create and join a private circle.** In Alex's window, open 圈子, fill 新圈名稱, and choose 建立圈. Choose 建立邀請連結 and copy the complete one-time link. Paste it into the already-authenticated River window, choose 送出加入申請, then return to Alex's 圈子 page and choose 核准加入. Refresh if needed; both windows can now select that circle. Do not paste the invitation into an ordinary signed-out browser.
2. **Create supply on both sides.** In Alex, use 新增供需 → 我可提供, select `10003` 霧瓶 / Mistvial, choose its `CLOUD_SAIL` form under the expanded conditions, and set quantity to 3. In River, create `10002` 燈芽 / Lamplume with standard conditions and quantity 3. In each editor, ensure the circle is checked under 分享範圍, then 儲存至帳本.
3. **Explore before matching.** Open 圈子 → the member's 查看供需. Browse 全部提供／全部想要. An empty demand list is expected: no demand has been created, but a proposal is still possible.
4. **Propose an exchange.** In Alex, use 向他主動提案 or 交換 → 新增雙向交換計畫. Choose River, add Alex's Mistvial and River's Lamplume, and initially propose 3 in each direction. No demand allocation is required.
5. **Revise and re-consent.** In River, open the proposal, choose 編輯雙方內容, change both quantities to 2, and save the new version. Alex must accept that revision with 接受並預留. Each supply now has held 3, reserved 2, available 1.
6. **Settle one item per side.** Open 進入交換現場, report 1 in each direction, and save. The other context chooses 確認本批已完成. Each supply becomes held 2, reserved 1, available 1; the rest of the plan remains reserved. A report without confirmation should not produce those deductions.
7. **Compare visibility scopes.** In a member list, choose 對我隱藏; use 我已隱藏 → 恢復顯示 to undo it. Alex, as circle owner, can separately inspect 管理員 · 本圈分享管理 and its explicit circle-wide removal/recovery behavior. These are different permissions and effects.
8. **Refresh.** Verify both local contexts retain the records. This demonstrates local persistence, not a hosted OAuth or cloud acceptance test.

To explore demand progress afterward, create an explicit demand and allocate a later proposal to it. The walkthrough deliberately demonstrates that unsolicited proposals work without inventing a demand record.

The synthetic sessions expire after 24 hours. Setup refuses existing demo state rather than overwriting it. Resume within that period without setup, or follow the deliberate cleanup/new-checkout procedure in the deployment guide for a fresh run. Never erase an unrecognized database to reproduce a screenshot.

## Three code-review conversations

### Why is sharing not a copy operation?

A listing has one owner, ID, quantity, and progress record. Circle membership changes which shares are visible. This prevents the same held item from being independently reserved in multiple circles.

Read `core/model.ts`, `core/store.ts`, and the actor-specific response code in `server/projection.ts`.

### How does the final unit survive competing requests?

Each business command observes an epoch and validates explicit record versions. Its D1 batch first advances the epoch conditionally, then a SQL CHECK guard converts a missed precondition into a failure of the entire batch. Retry receipts are written alongside the ledger.

Read `core/store.ts`, `tests/d1.test.ts`, and the concurrency/rollback cases in `tests/ledger.test.ts`. The cost is global write contention; a mature deployment might need more granular concurrency after measurement.

### Why is correction different from editing history?

A proposal is versioned consent. A delivery report is pending work. A confirmed batch changes quantities. A correction is another explicit record with its own agreement. These states prevent an edit or retry from silently rewriting what both people accepted.

Read `core/service.ts`, `core/replay.ts`, and the completion/correction tests.

## Product iteration represented in the code

The interface includes member browsing before matching, unsolicited proposals, independent provide/request drafts, system-aware themes, and separate personal/moderator visibility controls. Each addresses an observable interaction problem.

This public edition does not include private user messages, identity mappings, original deployment receipts, or a copied production history. Its evidence comes from its own synthetic setup and [verification record](VERIFICATION.md).

## What to evaluate

- Do tests enforce a real invariant rather than repeat the implementation?
- Does a failed or repeated operation preserve quantity and authorization?
- Can someone understand which audience an action affects?
- Are unknown values and unverified deployment claims explicit?
- Can a fresh contributor reproduce the local journey without private credentials?

## Ownership and AI assistance

The project owner defined the problem, supplied usage feedback, and made product/publication decisions. Codex assisted with implementation, test construction, debugging, research, and documentation.

This is not presented as entirely handwritten code or proof of unaided implementation. A useful interview discussion should explain the relevant code, defend tradeoffs, reproduce tests, and identify what should change under different scale or trust assumptions.

## Remaining work

Real-provider and deployed-boundary verification, secure account linking, physical-device and accessibility acceptance, production capacity, and provider-supported disaster recovery remain separate tasks. Explicit persisted draft/disputed plan states and a complete complementary match set across unloaded pages are not implemented.

No fabricated adoption metrics, performance SLA, or production-readiness certification is claimed.
