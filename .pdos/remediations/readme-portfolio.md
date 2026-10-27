# Remediation: README for product understanding and community use

- Remediation ID: REM-20261028-readme-portfolio-F001
- Review finding: reviews/readme-portfolio.md#F-001
- Status: verified
- Severity: medium
- Autonomy class: auto-decide
- Owner: documentation workstream
- Updated: 2026-10-27T19:33:31Z
- Decision authority: explicit user request to improve the portfolio and open-source README
- Reason: product value and design rationale must be discoverable without reading the implementation first
- Revisit condition: independent review finds unsupported claims or onboarding changes

## Plan

- Recommended solution: Rewrite both README languages around problem, workflow, evidence-backed decisions and practical onboarding; align the portfolio introduction.
- Acceptance criteria: See linked review; no code behavior, original repository or hosted-site changes.
- Verification plan: Reader/source review, document links/anchors/commands, publication scans, documentation diff and CI.
- Rollback: Revert the documentation-only commit.

## Evidence

- Implementation: Bilingual README rewrite with concrete quantities, four source-linked engineering choices, accurate runtime stack, runnable first exchange and grouped limits.
- Verification: Independent reader/source recheck passed; 64 links/images, 25 npm references, bilingual commands, publication/history checks pass.
- Residual risk: No new real-provider, physical-device or production verification is claimed.

## History

- 2026-10-28 open: Created from README reader and source-evidence review.
- 2026-10-27T19:31:04Z planned: Scope and evidence reviewed; bilingual documentation rewrite authorized..
- 2026-10-27T19:31:04Z in_progress: Rewrite drafted; independent reader and source review underway..
- 2026-10-27T19:33:31Z implemented: Both README languages and portfolio introduction rewritten; independent reviewer findings applied..
- 2026-10-27T19:33:31Z verified: Independent reader/source recheck passed; 64 links/images, 25 npm references, bilingual commands, publication/history checks pass..
