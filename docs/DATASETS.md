# Dataset contract and provenance

The bundled dataset is **trade-ledger-demo**, version **1.0.0**. It is original fictional test material, not a renamed copy of real game records.

| ID | 繁體中文 | English | Demonstration purpose |
|---|---|---|---|
| 10001 | 紙翼 | Paperwing | Basic supply/request matching |
| 10002 | 燈芽 | Lamplume | Shared `folded-light` family with Paperwing |
| 10003 | 霧瓶 | Mistvial | Explicit `CLOUD_SAIL` special form |
| 10004 | 錨星 | Anchorstar | A known non-tradable species |
| 10005 | 鈴砂 | Chimesand | Blocked `FUSED` form and an unknown form |
| 10006 | 織雲 | Loomcloud | Additional independent inventory |

These values exercise rules. They are not claims about any real game or creatures. The original names, labels, and rule fixtures are covered by the root [MIT license](../LICENSE).

## Pack files

The complete checked-in pack is `data/demo-catalog.json`. It contains metadata and items together; there is no separate real-game catalog or source manifest.

Catalog preparation validates this pack and writes ignored `data/active-catalog.generated.json`, which `core/catalog.ts` imports. Do not edit or commit the generated file. npm's prebuild, pretest, predev, and pretypecheck hooks prepare it automatically.

The contract is implemented in [core/catalog-schema.ts](../core/catalog-schema.ts):

- Metadata: `schemaVersion`, `datasetId`, `version`, `kind`, `title`, `license`, `source`, and `contentHash`.
- `items`: stable numeric-string IDs, Traditional Chinese and English labels, aliases, family identifiers, nullable trade status, and explicitly identified form/costume options.
- `kind`: `synthetic` for the original demo, `external` for a separately supplied catalog.
- `contentHash`: SHA-256 of UTF-8 `JSON.stringify(validatedPack.items)`, after schema validation. See [prepare-catalog.mts](../scripts/prepare-catalog.mts) for the exact validation and hash comparison. A hash-mismatch error reports the expected normalized-items digest; update it only after reviewing the intended content. A matching hash proves consistency, not provenance or permission.

Stable IDs are references from listings and historical plans, not array positions. Variant meaning must not be inferred from a display label. UNKNOWN is a condition state, not a catalog variant ID; `tradable: null` means unknown and must not be relabeled false or true without evidence.

## Select an external pack explicitly

With neither selection variable set, all prepare/build/test/dev/typecheck commands select the bundled synthetic pack. The tool does not download data.

An external pack requires **both** `CATALOG_PACK` (local file path) and `CATALOG_DATASET_ID` (expected ID). Keep private packs under ignored `data/private/` or another protected location. A missing file, schema error, content-hash mismatch, or unexpected ID fails; there is no silent fallback.

PowerShell:

```powershell
$env:CATALOG_PACK = 'data/private/catalog.json'
$env:CATALOG_DATASET_ID = 'my-catalog'
npm run catalog:prepare
npm run typecheck
npm run build
```

POSIX shell:

```sh
export CATALOG_PACK=data/private/catalog.json
export CATALOG_DATASET_ID=my-catalog
npm run catalog:prepare
npm run typecheck
npm run build
```

These examples assume you have already authored a valid, permitted pack with the stated ID. The bundled regression suite deliberately references the six synthetic entries. Run `npm test` with the default synthetic selection before switching catalogs; it is not an acceptance suite for an arbitrary external catalog. Add separate fixtures and compatibility tests for that catalog rather than weakening business rules or relabeling it to satisfy demo-specific assertions.

The variables are **build/test-time selection**, not a runtime hot-reload API. Local `demo:*` commands accept only an unchanged build of the original synthetic pack and an unbound checkout. To return to the standard demo, use a new shell without these variables, or clear them in the current shell, then rebuild.

## Rights and provenance

Before supplying a different catalog:

1. Record sources, exact versions or hashes, authorship, license terms, and scope of permission.
2. Review names, translations, artwork, compilations, and other third-party content separately. A public upstream repository is not by itself a redistribution license.
3. Give the dataset its own stable identity. Do not reuse fictional IDs for unrelated real records.
4. Preserve explicit unknown semantics. Inspect effects on listings, pending plans, reservations, and historical snapshots.
5. Test a candidate before deployment and keep private source material outside the public repository.

This edition includes no downloader for mined dumps or a real-game catalog. Build-time loading does not itself resolve upstream rights. Dataset metadata records an assertion of provenance; software validation does not prove legal permission.

## Immutable ledger binding

A ledger compares **dataset ID, schema version, version, kind, and content hash exactly**. The first business command binds an empty ledger inside its atomic write; an occupied unbound legacy ledger is rejected.

This means even a routine label/content update or version increment cannot be hot-swapped into an established ledger. Use a new database, or separately design and review a controlled migration with protected backups and explicit authorization. No general dataset-update migration is included. Do not force-edit the binding row to suppress a mismatch.

Full backups use schema version 2 and include the persisted binding. Personal JSON exports also use schema version 2 and include exact dataset ID/version/content hash. Import and restore reject version 1 and unrelated identities; they are not automatic migration tools.

The six-item demo pack must never be overlaid onto a real ledger. For ongoing code synchronization without reintroducing excluded data, follow [SYNC.md](SYNC.md).
