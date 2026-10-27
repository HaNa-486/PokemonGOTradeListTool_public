# Security policy

Trade Ledger handles private membership, delegated access, inventory, and exchange history. Source-code visibility, deployment access, circle permissions, and database access are separate security boundaries.

## Report a vulnerability privately

If GitHub private vulnerability reporting is enabled, use [Security → Advisories](https://github.com/HaNa-486/PokemonGOTradeListTool_public/security/advisories) and choose **Report a vulnerability**. This document does not assert that the repository setting has already been enabled.

If the private button is unavailable, use an existing private contact channel with the maintainer. If none is available, wait for a private channel rather than posting exploit details publicly. The maintainer must provide a working private reporting route before inviting public security reports.

Include the affected commit, impact, minimal reproduction with synthetic data, and expected behavior. Do not send live credentials or private backups. Test only systems and accounts you are authorized to use. No bounty or fixed response-time guarantee is offered.

## Supported scope

Security fixes target the maintained main branch. Older snapshots have no independent support guarantee. Review [verification evidence](docs/VERIFICATION.md) and known limitations before deploying.

The local demo uses pre-seeded synthetic sessions and real authorization checks. It is not evidence that a real identity provider, production routing, or cloud recovery works.

## Identity and deployment

- `SITES_CHATGPT_AUTH` defaults to disabled. Enable it only inside a verified managed Sites dispatcher boundary.
- The identity headers read by `server/sites-auth.ts` are trusted only because of that dispatcher. Matching an origin or receiving a header is not proof of identity on an arbitrary Worker or Node server.
- Before real deployment, verify visitor-supplied headers are stripped or overwritten, no direct Worker/API entrance bypasses the dispatcher, and service credentials cannot impersonate a user.
- Google OIDC code is configurable, but real credentials and end-to-end provider behavior require deployment-specific testing. Safe linking between Google and ChatGPT accounts is not implemented; do not merge accounts by email.
- Membership, delegation, circle administration, and maintenance backups have distinct authorization checks. There is no first-user administrator rule.
- Never expose the local demo through a tunnel or public interface. Never apply demo sessions or fixture SQL to a real database.

## Business and data integrity

Business writes must retain the command gate's epoch/version checks, SQL rollback guard, and payload-bound idempotency. A cached response still requires current authorization. Personal hiding is not a substitute for circle moderation.

Backups contain sensitive data even when sessions and secrets are excluded. Keep them in an ignored, access-restricted directory outside public artifacts; see [BACKUP.md](docs/BACKUP.md). An ignore rule is not encryption.

Dataset ID, schema version, version, kind, and content hash together form an immutable compatibility boundary. Backup/import schema version 2 enforces the relevant identity; legacy version 1 is rejected. Do not replace a real catalog with the demo catalog or reuse incompatible IDs over an existing ledger. Startup/setup rejection must not be bypassed to make a demonstration work. Even ordinary catalog changes require a controlled migration or a fresh database, not a manual edit to the binding row.

## If a secret or private record is committed

Stop publication and revoke or rotate the credential where applicable. Remove the exposed material from current content and affected history using an owner-approved recovery plan; deleting only the latest file is insufficient. Review forks, pull-request refs, logs, releases, artifacts, and attachments. Coordinate with the hosting provider if retained copies need removal.

Do not paste the secret into an issue or verification record. Record the affected category and remediation evidence without the value.

## CI boundary

CI needs no production secrets, cloud database, or deployment permission. Official actions are pinned; checkout credentials are not persisted. Avoid privileged pull-request execution and unreviewed changes that upload private files. Secret scanning and dependency audits are useful checks, not a complete security assessment.
