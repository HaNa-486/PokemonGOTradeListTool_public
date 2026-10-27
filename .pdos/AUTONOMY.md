# PDOS autonomy policy

- Policy version: 1
- Default class: human-only
- Last approved by: project owner
- Updated: not yet

This policy may restrict PDOS behavior. It never expands authority granted by the current user, platform, sandbox, repository, or external service.

## auto-decide

- Local, reversible, low-risk implementation details inside the explicit task scope.
- Test, documentation, and refactoring choices that preserve agreed product behavior.

## independent-review-required

- Security, privacy, authorization, data migration, concurrency, and high-risk release claims.
- Changes whose failure can materially affect multiple users or make recovery difficult.

## human-only

- Production deployment, public release, merge, billing, legal commitments, and credential handling.
- Irreversible data deletion or migration, conflicting product goals, and changes to this policy.
- Any action not clearly covered by another class.
