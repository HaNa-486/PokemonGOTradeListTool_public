# Third-party notices

The root [MIT license](LICENSE) covers this project's original application code, tests, documentation, and original fictional demo data. It does not replace existing third-party notices or grant rights the project does not own.

## Included software notices

| Component | Scope in this repository | Notice |
|---|---|---|
| Sites Vite integration | Vendored Sites build integration with its existing copyright | [MIT, copyright 2026 OpenAI](build/sites-vite-plugin.LICENSE) |
| shadcn Tailwind stylesheet | Vendored `vendor/shadcn-tailwind-4.13.0.css` | [MIT, copyright 2023 shadcn](vendor/shadcn-tailwind-4.13.0.LICENSE.md) |
| npm dependencies | Libraries resolved by `package-lock.json`; installed package code remains under its own terms | Consult each package's distributed LICENSE/NOTICE and package metadata |

Keep these notices when redistributing their corresponding files or substantial portions. A package lockfile identifies dependency versions; it is not itself a license inventory. Review the installed dependency notices and distribution requirements before shipping a new artifact or changing dependencies.

The application uses React, Vinext/Vite, Cloudflare tooling, Zod, and other dependencies listed in `package.json`. Their names describe technical dependencies and do not imply sponsorship.

## Dataset scope

`data/catalog.json` is the original **trade-ledger-demo** dataset. The six fictional species, names, form labels, and demonstration rules were created for this project. They are offered under the root MIT license.

This edition does not distribute the original private application's real-game catalog, PokeMiners dumps or mined translations, PokéAPI-derived species tables, game artwork, sounds, or models. A name in the repository URL is not a license to redistribute game content.

If you supply a different catalog, document its authorship, sources, exact version, license, and any restrictions separately. The project's MIT license cannot authorize third-party game data, trademark use, or an upstream's underlying rights. Follow [DATASETS.md](docs/DATASETS.md).

## Non-affiliation

Pokémon and other third-party product or company names belong to their respective rights holders. This project is independent and is not endorsed by Pokémon, Nintendo, Niantic, Scopely, or OpenAI. No third-party logos or character artwork are required for the bundled demo.
