# Verification record

Scope: the independently versioned community edition, using only its original synthetic catalog and local test identities. This record does not certify a production deployment.

## Evidence collected
- TypeScript type checking and production build passed locally; npm audit reported zero vulnerabilities.
- Final full application suite: 68/68 passed, including malformed-import, data identity, authorization and backup regressions.
- The local SQL adapter and actual Miniflare D1 test atomic binding, competing last-stock reservations, rollback, idempotency and consent.
- Browser journeys passed on Chromium with local D1 and two seeded accounts: bilateral revision/reservation/report/confirmation, exact stock deduction, custom variants, local draft recovery, personal hide/restore and full-circle moderation recovery.
- Editor checks covered widths 360, 390, 430, 768 and 1280 in light/dark appearance. Screenshots were visually reviewed; viewport emulation is not a physical-device test.
- Source sync/publication tests: 20/20 passed; repository guard tests: 8/8 passed. They exercise explicit allowlists, curated changes, community conflicts, malicious paths, stale proposals, source index preservation and reachable history.
- Human/agent review checked data isolation, local-only demo behavior, source synchronization and documentation. Reserved variant IDs, stale demo receipts and malformed import record envelopes were repaired with regressions.

## Limits
- Seeded local sessions are not real Google/ChatGPT authentication. No production sign-in, cloud audience, live two-person acceptance or new hosted deployment was performed.
- No physical-phone, assistive-technology, internet-scale throughput or production disaster-recovery claim is made.
- The local 1,000-listing pagination scenario checks bounded results. Timing is diagnostic because shared development/CI hardware is variable; it is not an SLA.
- Content checks detect known patterns and restricted paths; they cannot prove legal permission, authorship or the absence of all secrets.
- Exact dataset version/hash binding intentionally requires a new database or separately reviewed migration for catalog changes.
- The original application and its repository are outside this delivery and are not modified.

## Hosted CI
Implementation commit 2fbc2a5d5912e292cb1665abd010f37647a16757 passed [GitHub CI run 40564384121](https://github.com/HaNa-486/PokemonGOTradeListTool_public/actions/runs/40564384121). This was a fresh Ubuntu checkout: dependency install/audit, content and history guards, 20 sync tests, 8 repository-guard tests, type checking, 68 application tests, build, Chromium installation and both local-D1 browser journeys succeeded. No deployment secrets, cloud data or artifact uploads were used. Subsequent documentation-only commits retain their own checks on the repository Actions page.

## Publication decision
On 2026-10-28, the owner explicitly authorized publishing this source repository. The approved source commit 3f1688bc95046b3905d590fe602596aea5303538 passed [GitHub CI run 40570284039](https://github.com/HaNa-486/PokemonGOTradeListTool_public/actions/runs/40570284039). Repository visibility was changed to public and verified through an unauthenticated GitHub API request. Private vulnerability reporting was enabled and verified. The documented deployment limits still apply; the original repository and website were unchanged, and no website was published or redeployed.

Screenshot regeneration is opt-in: set UPDATE_PORTFOLIO_SCREENSHOTS=1 when running npm run demo:qa. Ordinary local/CI runs write screenshots to ignored test-results/, leaving the reviewed portfolio images unchanged.

## README review (2026-10-28)

The English and Traditional Chinese READMEs were reviewed independently for hiring-reader clarity and against source behavior. The documentation now leads with the Pokemon GO use case, a concrete shared-stock example, four linked design decisions and their costs, and a safe first exchange using explicitly tradable demo entries. Review corrected the proposal-edit boundary (before reservation) and the distinction between reservation quantities and separate completion records.

Static checks covered 64 relative links/images, 25 npm-script references, heading targets, and matching shell-command blocks/section counts across both languages. Content and reachable-history guards passed. These were documentation-only edits; local business/browser suites were not rerun for this review. The existing application baseline above remains the recorded functional evidence; exact-commit hosted runs are on the [Actions page](https://github.com/HaNa-486/PokemonGOTradeListTool_public/actions/workflows/ci.yml).
