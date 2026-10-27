# Contributing

Trade Ledger welcomes focused fixes, clear bug reports, documentation, accessibility improvements, and tests. Original contributions to this repository are made under its [MIT license](LICENSE); do not submit material you cannot license. Existing third-party terms remain applicable.

## Make a useful contribution

1. Open an issue for a substantial feature or behavior change. Explain the user problem and the expected quantity, visibility, or consent behavior.
2. Work in a branch. Keep unrelated formatting, dependency upgrades, and refactors out of a focused fix.
3. Use fictional data. Follow the [local setup](docs/DEPLOYMENT.md), then reproduce the problem before changing it.
4. Run the checks appropriate to the change:
   ```sh
   npm run check:repository
   npm run test:repository
   python scripts/check-public-content.py --history
   npm run typecheck
   npm test
   npm run build
   ```
5. For interactive behavior, start the local demo and run `npm run demo:qa`; inspect phone-sized and desktop layouts, both themes, keyboard interaction, and failure states.
6. Describe the problem, resulting behavior, verification, and remaining limitations in the pull request. Screenshots must use synthetic data and identify simulated devices as simulations.

AI assistance is welcome when the contributor understands and reviews the result. Explain significant design decisions and provide evidence; generated output is not a test result.

## Rules that protect the ledger

- A listing shared across circles has one identity, quantity, and progress record.
- UNKNOWN is distinct from NONE, false, and ANY. Merge only an exact condition match after confirmation.
- All business mutations use the command gate in `core/store.ts`. Preserve epoch, SQL CHECK guards, explicit versions, and content-bound idempotency.
- Reservations cannot exceed capacity. Pending delivery cannot be released unilaterally. Retries cannot deduct twice.
- Completed history cannot become a different species. Receiving an item does not silently create new supply.
- Replays recheck authorization; response projections cannot expose another circle's private information.
- Personal hiding affects one viewer. Circle moderation has a distinct, explicit scope.
- Synthetic data and test sessions stay local. Do not add a production test-login route.

Authorization, concurrency, backup, schema, and security changes need independent review. Applied migrations must not be rewritten. Deployment, destructive data operations, and repository visibility are separate owner decisions.

## Protect private material

Never include real accounts, tokens, invitation secrets, personal or deployment backups, database files, SQL dumps, private screenshots, or environment secrets in issues, commits, or CI artifacts. Store local demo state in ignored directories. Review `git diff --cached`; ignore rules do not protect already tracked files.

The repository checker scans known patterns and sensitive paths in tracked/index content and reachable history. It reports locations and categories, not secret values. It does not prove the absence of every credential or inspect every remote attachment.

Report vulnerabilities through [SECURITY.md](SECURITY.md). Do not test attacks against someone else's deployment.

## Data and dependencies

The bundled dataset is fictional. Do not restore real game dumps, mined text, artwork, or copied catalogs. New data needs documented provenance and compatible rights; see [DATASETS.md](docs/DATASETS.md).

Use the lockfile with `npm ci`. Review both manifest and lockfile when changing dependencies. Preserve licenses for vendored code and update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when necessary.

CI uses read-only repository permissions and does not deploy. External pull requests must never receive production secrets or run through a privileged trigger. Passing CI is evidence for its checks, not approval to deploy or a substitute for real-user acceptance.
