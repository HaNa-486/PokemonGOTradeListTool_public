# Local setup and deployment boundaries

The default deliverable is a local, synthetic-data application. This repository has no production project ID and performs no automatic cloud deployment.

## Local demo

Use Node.js 24, npm, Python 3.12, and Git. Start from an unbound checkout. The demo refuses a hosting manifest with a project ID and any file beginning with `.env` (except `.env.example`) or `.dev.vars` in the repository root or `dist/server/`. This includes environment-specific configuration such as `.env.local`. The first install may take several minutes. Install locked dependencies and the browser, then build:

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run demo:setup
```

Keep `npm run demo:start` running in one terminal. In another terminal, run `npm run demo:open` for two isolated synthetic users. Keep its terminal open; pressing Enter closes both windows. Alternatively, `npm run demo:qa` runs the automated browser journey and closes its own contexts when finished.

For both automated browser journeys, stop any existing demo server and run `npm run demo:ci` after the same build and one-time setup. It requires port 8787 to be free, starts its own local server, and closes only its own processes when finished. Both automated journeys write disposable synthetic records to the demo database.

The server is restricted to `https://127.0.0.1:8787` and local persistence. Browser automation uses the local development certificate only for its isolated loopback contexts. Do not disable TLS verification globally.

`demo:setup` is a one-time initialization: it refuses **any existing `.sites-runtime/demo/state` directory or `.sites-runtime/demo/sessions.json`**, even from a compatible previous demo. It creates two 24-hour synthetic sessions, an initialization file and a build receipt under `.sites-runtime/demo/`. It does not create circles or inventory; follow [PORTFOLIO.md](PORTFOLIO.md#local-walkthrough) for those steps. The first business write atomically binds the empty ledger to the catalog.

During the 24-hour session period, resume with `demo:start` and `demo:open`; do not rerun setup. If sessions expire, the simplest reset is a fresh clone in a new directory. To deliberately discard this checkout's disposable demo instead, first stop both browser/server processes, verify the resolved `.sites-runtime/demo/` path is inside this public checkout and contains only this demo's data, then manually remove that exact directory using your file manager. This loses the demo ledger; preserve any work you want first. Run setup again only after that deliberate cleanup. Never clean a parent directory, an unknown database, or production state. A partially failed setup may leave `setup.sql`; inspect and handle the same exact demo directory rather than overwriting files.

The demo also checks the build receipt and distribution hash. If source or catalog changes, rebuild before starting. An external catalog build is not accepted by demo commands.

Ordinary browser tabs without a seeded cookie remain signed out. The demo does not call an external identity provider. It does not prove real ChatGPT/Google login, real cloud persistence, or a two-human exchange.

Playwright Chromium on Linux may need operating-system libraries. Install the documented Playwright browser dependencies for your system; no cloud account is needed for the local app. Do not commit installed browsers, local sessions, database files, or test output.

## Configuration

| Setting | Meaning |
|---|---|
| `APP_ORIGIN` | Exact HTTPS origin of the intended environment |
| `SITES_CHATGPT_AUTH` | Disabled locally; may be enabled only behind a verified Sites dispatcher |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional provider configuration; the secret belongs in secret storage |
| `MAINTENANCE_USER_IDS` | Explicit internal IDs allowed to download full backups; empty means nobody |
| `CATALOG_PACK` + `CATALOG_DATASET_ID` | Build/test-time external catalog path and expected dataset ID; both required when selecting an external pack |

`CATALOG_PACK` is consumed by catalog preparation before build, test, dev, and typecheck; it is not a runtime hot-reload setting. With neither variable set, preparation selects `data/demo-catalog.json`. External pack instructions and exact binding rules are in [DATASETS.md](DATASETS.md).

Use `.env.example` as a description, not as a working deployed configuration. Do not paste credentials into chats, Git, issues, or build output. The original private system's configuration and database are not part of this repository.

## Deploy your own instance

This code targets Sites and its D1 binding. Deployment requires access to your own supported Sites environment; this guide does not promise account eligibility, free hosting, or a generic one-click deployment to another platform.

1. Select a project you control through the Sites workflow. Update your own `.openai/hosting.json` with the platform-issued project binding; keep the DB binding consistent. Do not invent an ID or reuse someone else's target.
2. Choose a dataset you have rights to use and prepare it with its explicit ID before building. The ledger binds its ID, schema version, version, kind, and content hash exactly. Changing content or version requires a controlled migration or a new database; no migration is supplied for existing real data. Synthetic demo data is not a migration for real records.
3. Configure the exact origin and provider secrets in that project's environment. Do not upload local demo sessions, fixture SQL, database files, or private backups.
4. Initialize a genuinely new database using reviewed migrations. Never rerun an initial migration over existing data or replace applied migration files.
5. Start with the intended restricted audience and validate identity, circle permissions, anonymous/spoofed requests, direct-entry routing, retries, refresh, and persistence.
6. Review the exact source version, verification, backups, rollback compatibility, and remaining limitations before publication.

Sites identity headers are safe to trust only within the verified dispatcher. Do not enable that trust on an independently reachable Worker, Node server, preview, or proxy. A service credential is not a user identity.

## Google and account linking

Google OIDC code is included but real credentials and end-to-end operation are not established by the synthetic demo. A deployment's callback is its exact origin followed by `/auth/google/callback`; the requested scope is `openid`. Register only the values for your own instance.

Safe linking of Google and ChatGPT accounts is not implemented. Do not infer that matching email addresses are the same identity. Conflicting active identities must fail closed and require the user to choose a login context.

## Release and recovery

CI builds and tests; it does not deploy. A local or CI pass does not authorize changes to audience, accounts, infrastructure, or real data.

Take a protected, validated backup before consequential data changes. A code rollback does not automatically undo schema changes. Preserve compatible migrations and verify restore procedures separately; see [BACKUP.md](BACKUP.md) and [SECURITY.md](../SECURITY.md).
