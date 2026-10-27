# Review: README for product understanding and community use

- Review ID: REV-20261028-readme-portfolio
- Mode: review-and-fix
- Status: open
- Created: 2026-10-28
- Scope: bilingual README and supporting portfolio introduction; documentation only
- Release assessment: documentation review in progress; no deployment or visibility decision

## Findings

### F-001

- Severity: medium
- Confidence: high
- Status: open
- Evidence: At base a5b98e5686c46c1dfcaff76bbe876da55591e99e, README.md and README.zh-TW.md introduce ledger/concurrency language before identifying the Pokemon GO audience, put installation before design rationale, and provide unequal architecture/contribution detail. Independent reader review reproduced the missing first-screen use case. Source review located the four strongest implemented choices and checked the local demo.
- User impact: A hiring reviewer cannot quickly identify the use case or judge the design; a new contributor must infer the first steps after opening an empty demo.
- Root cause: Documentation was organized around release safeguards and feature coverage instead of reader questions.
- Recommended solution: Lead with user/problem/outcome, explain a concrete stock example, connect four choices to reasons and source evidence, preserve direct onboarding and honest limits in equivalent bilingual structures.
- Alternatives and tradeoffs: A separate portfolio-only landing page would split the main explanation. A feature-only summary would omit engineering evidence; a code-heavy README would obscure the user flow. Keep a concise main story with deeper document links.
- Affected areas: README.md, README.zh-TW.md, docs/PORTFOLIO.md
- Acceptance criteria: Both READMEs identify audience and purpose immediately, show a correct stock example and workflow, link implemented decisions and tests, explain relevant costs, offer executable setup/first actions, and distinguish local from hosted verification.
- Verification: Independent reader and source-evidence reviews; validate relative links, anchors, npm commands and bilingual structure; publication checks; hosted CI on the documentation commit.
- Residual risk: Editorial clarity is not a measured hiring outcome. Existing authentication/production limitations remain unchanged.
- Autonomy class: auto-decide
- Remediation: remediations/readme-portfolio.md
