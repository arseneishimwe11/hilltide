# Licenses

Every dependency, dataset, font and model Hilltide uses, with its license.
"Verified" means the license was read from the package's own license file or
metadata as installed, or from the publisher's license page for data.

Hilltide's own code license is the owner's decision and is not chosen yet
(see docs/STATUS.md, "Needs owner").

## Flags

Terms that need attention before relying on them.

| Item | Term | What it means for Hilltide | Status |
|---|---|---|---|
| lightningcss (and platform builds) | MPL-2.0, weak copyleft per file | Build tool pulled in by Vite. Not shipped in the site, not modified. No obligation on our code. | Accepted, build-time only |
| OpenStreetMap data | ODbL 1.0, share-alike for derived databases | Packed river, lake and label files derived from OSM must be offered under ODbL with attribution. The rendered scene is a "produced work" and only needs attribution. | Planned for Phase 1; to verify against the license text then |
| Copernicus DEM | Own license (not Creative Commons) | Free use including commercial, with a mandatory credit line. | Planned for Phase 1; to verify against the license text then |
| pysheds, richdem | GPL-3.0 | Not used. Flow accumulation is written in-house instead. | Avoided |

## Web app: direct dependencies (all development or build time)

Verified on 2026-11-15 from each package's license file in `node_modules`.

| Package | Version | License | License file | Shipped in site |
|---|---|---|---|---|
| vite | 8.3.8 | MIT | LICENSE.md | No |
| typescript | 7.0.2 | Apache-2.0 | LICENSE, NOTICE.txt | No |
| vitest | 5.1.0 | MIT | LICENSE.md | No |
| @biomejs/biome | 2.6.8 | MIT OR Apache-2.0 | LICENSE-MIT, LICENSE-APACHE | No |
| @playwright/test | 1.63.0 | Apache-2.0 | LICENSE, NOTICE | No |
| @types/node | 22.20.5 | MIT | LICENSE | No |

Nothing third-party is shipped in the site bundle yet.

### Transitive packages

104 packages in `web/package-lock.json`, by declared license:

| License | Packages |
|---|---|
| MIT | 52 |
| Apache-2.0 | 26 |
| MPL-2.0 (lightningcss and its platform builds) | 12 |
| MIT OR Apache-2.0 | 11 |
| ISC | 1 |
| BSD-3-Clause | 1 |
| 0BSD | 1 |

No GPL, AGPL, non-commercial or unknown licenses.

## Data pipeline: dependencies (development only so far)

Verified on 2026-11-15 from each package's metadata and license file in the
virtual environment.

| Package | Version | License |
|---|---|---|
| pytest | 9.2.0 | MIT |
| ruff | 0.17.5 | MIT |
| pluggy | 1.7.0 | MIT |
| iniconfig | 2.3.1 | MIT |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pygments | 2.21.0 | BSD-2-Clause |

## Datasets (planned, not yet downloaded)

Each is verified against its license text when first downloaded, and its
required attribution is added to the site's credits.

| Dataset | Use | Expected license | Verified |
|---|---|---|---|
| Copernicus DEM GLO-30 and GLO-90 | Terrain | Copernicus DEM license, credit required | Not yet (Phase 1) |
| Google Open Buildings v3 footprints | Building shapes | CC BY 4.0 (also offered under ODbL) | Not yet (Phase 1) |
| Google Open Buildings 2.5D Temporal | First year and height per year | CC BY 4.0 | Not yet (Phase 1) |
| OpenStreetMap (Rwanda extract) | Rivers, lakes, place labels | ODbL 1.0 | Not yet (Phase 1) |
| Natural Earth | Country border | Public domain | Not yet (Phase 1) |
| ESA WorldCover | Land tint, infiltration classes | CC BY 4.0 | Not yet (Phase 1) |

## Fonts (planned, not yet added)

The placeholder page uses system fonts only. Self-hosted typefaces are added
in the design phase, each verified against its OFL text.

| Font | Use | Expected license | Verified |
|---|---|---|---|
| Newsreader | Chapter titles | SIL OFL 1.1 | Not yet (Phase 6) |
| Instrument Sans | Interface text | SIL OFL 1.1 | Not yet (Phase 6) |
| IBM Plex Mono | Figures | SIL OFL 1.1 | Not yet (Phase 6) |

## Models

None. Hilltide uses no machine-learning models. Building footprints and
heights come from Google's published datasets, which were produced by models
on Google's side; the site states that heights are estimates.
