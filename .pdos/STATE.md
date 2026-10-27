# PDOS state

- Protocol version: 0.4.0-alpha.1
- State revision: 4
- Updated: 2026-10-28
- State confidence: owner-authorized-public-source; anonymous-access-and-reporting-settings-verified
- Phase: public-source-maintenance

## Repository identity
- Branch: main
- Observed commit: 3f1688bc95046b3905d590fe602596aea5303538

## Product anchors
- Primary user: private trading communities, community contributors and hiring reviewers evaluating a multi-user trade planner.
- Product outcome: coordinate shared supply/demand and bilateral exchanges; runnable source with original demo data, explainable design and reproducible checks.
- Critical journey: clean install → synthetic local users → authorized shared D1 ledger → bilateral proposal → reserve → report → confirm.
- Non-goals: publishing or changing any website, changing the original private application, distributing game data or production credentials.

## Current work
- Current slice: owner-authorized source publication completed; release/security documentation aligned with verified public visibility.
- Active workstreams: none; readme-portfolio completed
- Active review: reviews/readme-portfolio.md
- Active remediations: remediations/readme-portfolio.md
- Blocking dependencies: none for the authorized repository visibility change.
- Consequential open decisions: future website publication and production configuration/verification require separate authorization.

## Handoff
- What changed: public source visibility and private vulnerability reporting enabled after explicit owner approval; verification/security notes updated. Product code, original repository and website remain unchanged.
- Verification evidence: approved commit passed hosted CI run 40570284039; GitHub reports PUBLIC, unauthenticated API reads succeed, private vulnerability reporting reports enabled. Original repository remains private with unchanged main commit. Prior README checks and independent reviews are recorded in ../docs/VERIFICATION.md and remediation.
- Existing application baseline: 68 application, 20 sync and 8 repository tests plus two browser journeys; hosted CI at observed commit passed. Current commit results are available in repository Actions; this documentation review did not rerun local business/browser tests.
- Not verified: new production deployment, real provider credentials, real cloud users, physical devices, capacity and production recovery.
- Residual risks: content scanners do not prove rights or absence of every secret; synthetic fixtures do not prove OAuth; editorial review is not a measured hiring outcome.
- Next safe action: maintain public issues and private security reports; apply reviewed source-sync proposals for future changes while keeping the original project/site unchanged.

## Read next
- AUTONOMY.md
- reviews/readme-portfolio.md
- remediations/readme-portfolio.md
- ../README.md
- ../README.zh-TW.md
- ../docs/VERIFICATION.md
- ../docs/PORTFOLIO.md
