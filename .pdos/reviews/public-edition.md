# Public edition independent review
- Review ID: public-edition-2026-10-28
- Mode: review-and-fix
- Status: verified
- Created: 2026-10-28
- Scope: synthetic catalog, database isolation, personal import, local demo, synchronization and publication content.
- Release assessment: local implementation reviewed; private upload permitted, public conversion requires owner approval.

### F-001
- Severity: high
- Confidence: high
- Status: verified
- Evidence: a numeric personal-import source ID could enter a persisted preview job and violate the full-backup schema.
- User impact: malformed personal input could prevent full backup validation.
- Root cause: preview checked ID truthiness instead of the complete exported record envelope.
- Recommended solution: validate backupListing before extracting fields or persisting sourceId.
- Alternatives and tradeoffs: rejecting only numeric IDs misses other malformed envelope fields; full validation rejects unsupported exports explicitly.
- Affected areas: core/service.ts, tests/ledger.test.ts.
- Acceptance criteria: numeric/object/oversized/null IDs produce conflicts and full backup remains valid.
- Verification: independent focused reproduction and regression pass; included in 68-test final suite.
- Residual risk: full production restore remains an operator-controlled task, not demonstrated by local tests.
- Autonomy class: independent-review-required
- Remediation: remediations/public-edition.md

### F-002
- Severity: medium
- Confidence: high
- Status: verified
- Evidence: a static variant named custom:... or a reserved state could pass catalog validation but collide with database variants or displayed labels.
- User impact: accepted external data could become unusable or misleading in the editor.
- Root cause: shared value namespaces were not enforced at the catalog boundary.
- Recommended solution: reject reserved namespaces and require explicit NONE with stable built-in meanings.
- Alternatives and tradeoffs: trait-aware IDs would require a larger model migration; the explicit contract preserves existing domain boundaries.
- Affected areas: core/catalog-schema.ts, tests/catalog-pack.test.ts.
- Acceptance criteria: invalid reserved IDs, missing NONE and label collisions fail preparation.
- Verification: independent catalog regressions pass; included in final suite.
- Residual risk: schema validation cannot establish external data rights or factual correctness.
- Autonomy class: independent-review-required
- Remediation: remediations/public-edition.md

### F-003
- Severity: medium
- Confidence: high
- Status: verified
- Evidence: build identity/name alone did not prove it contained the current checked-in demo content.
- User impact: stale or replaced data could be represented as the original local demo.
- Root cause: the distribution hash was checked without comparing the source pack content hash.
- Recommended solution: compare the rehashed demo pack, build receipt and distribution.
- Alternatives and tradeoffs: full source reproducible-build attestation is beyond local demo scope; the content contract addresses the actual dataset mismatch.
- Affected areas: scripts/demo-runtime.mjs, tests/demo-identity.test.ts.
- Acceptance criteria: old/different dataset content fails demo validation.
- Verification: independent stale-content tests pass; final browser runner succeeds on the matching build.
- Residual risk: maintainers must rebuild after code changes; this is not a signed supply-chain attestation.
- Autonomy class: independent-review-required
- Remediation: remediations/public-edition.md

## Independent scope
An independent reviewer reproduced and rechecked the three findings (5 focused tests), and independently ran 19 synchronization tests. Root reviewed the binding implementation and collected the full 68-test, build and two browser-journey results. No remaining high/medium finding was identified in this scope. Hosted CI is recorded separately in docs/VERIFICATION.md.
