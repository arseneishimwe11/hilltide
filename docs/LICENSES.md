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
| OpenStreetMap data | ODbL 1.0, share-alike for derived databases | Packed river, border and label files derived from OSM are offered under ODbL with attribution. The rendered scene is a "produced work" and only needs attribution. | In use |
| Copernicus DEM | Own licence (not Creative Commons) | Free for the general public with a mandatory credit line. Commercial-use terms not yet confirmed (see Datasets notes). | In use |
| GEOS (inside shapely wheels) | LGPL-2.1 | Pipeline only, dynamically linked, unmodified. Not shipped in the site. | Accepted, build-time only |
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

## Datasets

Each license was read from the publisher's own page on 2026-11-15. The
credit text is stored in `pipeline/src/hilltide_pipeline/sources.py`, copied
into `web/public/data/manifest.json`, and shown in the site's credits.

| Dataset | Use | License | Where it was verified |
|---|---|---|---|
| Copernicus DEM GLO-30 and GLO-90 | Terrain | Copernicus DEM free licence, credit required | Copernicus Data Space COP-DEM page, "User Obligations" (credit text quoted from there); AWS registry page for free public access |
| Google Open Buildings v3 | Building footprints | CC BY 4.0 or ODbL 1.0, user's choice. Used under CC BY 4.0. | sites.research.google/gr/open-buildings, "How is the data licensed?" |
| Google Open Buildings 2.5D Temporal | First year and height per year | CC BY 4.0 or ODbL 1.0, user's choice. Used under CC BY 4.0. | sites.research.google/gr/open-buildings/temporal, "How is the data licensed?" |
| OpenStreetMap, Rwanda extract (openstreetmap.fr) | Rivers, borders, place names | ODbL 1.0 | openstreetmap.org/copyright |
| ESA WorldCover 10 m 2021 v200 | Lakes, terrain tint, infiltration classes | CC BY 4.0 | esa-worldcover.org/en/data-access, "License" (credit text quoted from there) |

Notes:
- Copernicus DEM: the Data Space page states the data is "available
  worldwide with a free license" and that the general public may download
  GLO-30 and GLO-90. That page does not mention commercial use either way.
  The full licence PDF it links could not be opened from the sandbox, so the
  commercial-use terms are not yet confirmed. Hilltide is non-commercial
  today; confirm before any commercial product is built on it.
- OpenStreetMap: the packed files under `web/public/data/water/`,
  `border/` and `labels/` are derived databases and are offered under
  ODbL 1.0. The rendered scene only needs the credit line.
- Google's building heights were evaluated only in North America, Europe and
  Japan (mean absolute error 1.5 m there), and presence values are
  uncalibrated. The site states that heights are estimates.
- Natural Earth was planned for the border and is not used.

### Data pipeline: geospatial dependencies

Verified on 2026-11-15 from each package's metadata in the virtual
environment.

| Package | License |
|---|---|
| numpy | BSD-3-Clause |
| scipy | BSD-3-Clause |
| rasterio (bundles GDAL, MIT) | BSD-3-Clause |
| shapely (bundles GEOS, LGPL-2.1, dynamically linked) | BSD-3-Clause |
| pyproj (bundles PROJ, MIT) | MIT |
| osmium | BSD-2-Clause |
| requests | Apache-2.0 |

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
