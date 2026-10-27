<!-- PDOS:START -->
## PDOS project continuity

This project uses Product Development Operating System (PDOS).

- For substantial product or feature work, use `$pdos` and read `.pdos/STATE.md` before planning or changing code.
- Treat `STATE.md` as the concise handoff index. Read only the current plan and the specs, decisions, or reviews relevant to the task; do not load the entire `.pdos/` tree by default.
- Read `.pdos/AUTONOMY.md` before implementing review findings. Project policy may restrict behavior but never expands user or platform authority.
- Treat plain “review” as read-only, “review and plan” as artifact planning without product changes, and “review and fix” as permission to repair only in-scope findings under the autonomy policy.
- Track saved findings in `.pdos/reviews/` and execution in `.pdos/remediations/`; never mark a remediation verified without acceptance evidence.
- Reconcile stale state against current user instructions, repository evidence, tests, and observable behavior.
- Check active files under `.pdos/workstreams/` before overlapping changes; keep one scoped workstream record per substantial context.
- Before finishing substantial work, update `STATE.md` with changes, verification, residual risks, relevant-file pointers, and one next safe action.
- Commit sanitized shared PDOS state, keep local/private notes in ignored directories, and never store secrets or raw customer data in `.pdos`.
- Keep absolute machine paths and environment identity only under ignored `.pdos/local/`, not shared state.
- Do not impose the full PDOS lifecycle on tiny mechanical edits or simple factual questions.
<!-- PDOS:END -->
