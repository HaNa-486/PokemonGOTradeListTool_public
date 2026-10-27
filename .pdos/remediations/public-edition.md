# Remediation: public-edition review findings
- Remediation ID: public-edition-2026-10-28
- Review finding: reviews/public-edition.md#F-001
- Related findings: F-002, F-003
- Status: verified
- Severity: high
- Autonomy class: independent-review-required
- Owner: root implementation with independent review
- Updated: 2026-10-27T18:53:58Z
- Decision authority: owner explicitly authorized scoped implementation, self-review and repair in the separate private candidate.
- Reason: repair concrete public-candidate correctness and backup safety defects.
- Revisit condition: data contract, import envelope or local demo identity changes.

## Plan
- Recommended solution: validate full import records, reserve variant namespaces and bind demo receipts to rehashed original content.
- Acceptance criteria: malformed imports leave backups valid; ambiguous catalog IDs and stale demo content fail.
- Verification plan: focused independent regressions, complete suite, build and real local browser journeys.
- Rollback: stop candidate delivery; retain the separate private history. No production migration or old-repository rollback is required.

## Evidence
- Implementation: core/service.ts, core/catalog-schema.ts and scripts/demo-runtime.mjs.
- Verification: Independent 5-test reproduction checks and final 68-test suite, build and two local browser journeys passed
- Residual risk: see docs/VERIFICATION.md for external/production limits.

## History
- 2026-10-28 implemented: scoped repairs prepared after independent reproduction.
- 2026-10-27T18:53:58Z verified: Independent 5-test reproduction checks and final 68-test suite, build and two local browser journeys passed.
