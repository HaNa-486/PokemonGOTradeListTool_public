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
Pending the first private push. Successful local checks are not presented as hosted CI evidence.

## Publication decision
The source is being prepared for open-source review. The repository remains private. Changing GitHub visibility requires a separate owner confirmation; that does not authorize publishing any website.
