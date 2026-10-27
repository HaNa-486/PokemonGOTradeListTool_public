# Backups and isolated recovery

Personal exports and full deployment backups have different scopes. Neither belongs in a public repository, pull request, CI artifact, or screenshot.

## Personal data

The account interface exports the current user's JSON/CSV and authorized history. Circle administrators can export a scoped circle view, not an unrestricted database copy. CSV cells are escaped against spreadsheet formula interpretation.

Personal JSON exports and imports use `schema_version: 2` with exact `datasetId`, `version`, and `contentHash`. Version 1 exports and nonmatching catalogs are rejected rather than guessed or relabeled.

Personal import is deliberately limited: validate first, preserve an import-before backup, confirm explicitly, and reject incompatible or history-bound records. It is not a complete disaster-recovery mechanism.

## Full deployment backup

Only internal user IDs explicitly listed in `MAINTENANCE_USER_IDS` may download the full backup. Circle administrators and the first person to sign in do not automatically receive this permission.

The full snapshot uses `schema_version: 2` and includes the persisted `dataset_bindings` row, identity mappings, business entities, shares, audit history, epochs, and selected retry receipts. Restore requires an exact catalog ID, schema version, version, kind, and content hash match; version 1 and unrelated backups are rejected. It excludes live sessions, OAuth flows, runtime secrets, invitation credentials, and invitation retry receipts. Excluding credentials does **not** make the remaining file public: it still contains private identity and business information.

Store backups under an access-restricted location such as ignored `backups/`, with protection appropriate to the machine and data. Ignore rules prevent some accidental commits; they do not encrypt files or protect already tracked content.

## Validate without writing

Prepare the exact matching catalog first. For the bundled synthetic catalog, run `npm run catalog:prepare`. For an external catalog, set both `CATALOG_PACK` and `CATALOG_DATASET_ID` as described in [DATASETS.md](DATASETS.md), then run preparation. Do not change a backup's identity fields to make it pass.

```sh
node --import tsx scripts/restore-backup.mts backups/deployment-backup.json
```

Validation checks entity schemas, foreign keys, participant/role relationships, reservations, completed quantities, corrections, and audit consistency. It cannot prove authenticity if an attacker has consistently rewritten an entire backup; use trusted, protected inputs.

## Restore into a new local database

```sh
node --import tsx scripts/restore-backup.mts backups/deployment-backup.json backups/rehearsal-new.sqlite --confirm-new-empty-database
```

The destination must not already exist. Exclusive creation and a SQLite transaction prevent overwriting an existing file and avoid a partial successful restore. The utility never accepts a remote database target. A failed attempt may leave a newly created empty destination; inspect it and choose another new path rather than overwriting it.

Do not use a real deployment backup as a demo fixture. Keep dataset identity and schema compatibility intact; synthetic IDs are not replacements for real historical IDs. A newly rebuilt catalog with different content/version cannot restore an old backup without a separately reviewed migration; the restore utility is not that migration.

## What a rehearsal proves

A successful local restore demonstrates that the selected backup passes this validator and can populate the local schema. It does not demonstrate cloud-provider recovery, correct permissions after a production restore, or a completed real disaster-recovery exercise.

Production recovery needs explicit authorization, a fresh protected backup of current state, a provider-supported plan, compatibility checks, and an independently reviewed rehearsal. Never treat an automatic drop/recreate or personal JSON import as that plan.
