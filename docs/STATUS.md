# Hilltide: status

Last updated: 2026-11-15, end of Phase 0.

A new session can resume from `CLAUDE.md`, `docs/PROJECT_BRIEF.md` and this
file. Decisions are in `docs/DECISIONS.md`, licenses in `docs/LICENSES.md`.

## Where things stand

| Phase | State |
|---|---|
| 0 Foundations | Done |
| 1 Data pipeline | Next (plan below) |
| 2 The Land | Not started |
| 3 Kigali Builds Itself | Not started |
| 4 Make It Rain | Not started |
| 5 Validation | Not started |
| 6 Story and design | Not started |
| 7 Capture mode | Not started |
| 8 Performance and release | Not started |

## Needs owner

Things only the owner can do. None of them block Phase 1.

1. **Enable GitHub Pages.** Repository Settings > Pages > Build and
   deployment > Source: choose "GitHub Actions". Until then the Deploy
   workflow builds the site, shows a "Not deployed" warning and skips
   publishing. After enabling, re-run the Deploy workflow from the Actions
   tab (or it runs on the next push). The repo is public, so Pages is free.
   Expected address:
   `https://arseneishimwe11.github.io/hilltide/`.
2. **Choose a license for Hilltide's own code** (for example MIT). Until
   chosen there is no LICENSE file, which means all rights reserved.
3. **Fill in `site.config.json`**: creator name, links, and the site URL once
   Pages is live. The page hides the credit line while the name is still the
   placeholder.
4. **Commit author.** Commits are authored as "Claude" with a noreply
   address. Say so if you want your own name and email on future commits.
5. Later phases will add: test on your phone and laptop, review Kinyarwanda
   strings with a native speaker, re-export the clips on a real GPU.

## Sandbox (measured 2026-11-15)

| Item | Value |
|---|---|
| CPU | 4 cores |
| RAM | 15 GB |
| Disk free | 31 GB |
| GPU | None. All browser tests use software rendering. |
| Tools | Node 22.23, npm 10.9, Python 3.13, uv 0.11, ffmpeg 6.1. No GDAL (rasterio wheels bundle it). |
| Browser | Chromium for Playwright 1.63.0, pre-installed |
| Network | Unrestricted, through a proxy |

Reachable: Copernicus DEM on S3 (30 m and 90 m buckets), Google Open
Buildings buckets on Cloud Storage (`open-buildings-data` v3 and
`open-buildings-temporal-data` v1), openstreetmap.fr extracts, npm, PyPI.

Not reachable: `download.geofabrik.de` and Overpass servers drop the
connection. Use `download.openstreetmap.fr/extracts/africa/rwanda-latest.osm.pbf`.

## Phase 0 report

### What works
- The four owner files exist exactly as specified.
- Web app scaffold in `web/`: Vite 8, TypeScript 7 (strict), Biome, Vitest,
  Playwright. A placeholder page in the project palette, with all text in a
  typed message catalog (`web/src/i18n/en.json`) ready for translation.
- The test that fails if site text claims to forecast or warn about floods
  exists from the first commit (`web/src/i18n/claimsGuard.ts`), and also runs
  against the rendered page in the browser test.
- Pipeline scaffold in `pipeline/`: uv project, ruff, pytest, a `paths` module
  that keeps raw data outside the site.
- Site size guard (`scripts/check-site-size.mjs`): fails a build with any file
  over 50 MB or a total over 100 MB.
- CI on every push: lint, typecheck, unit tests, build, size guard, headless
  browser tests with screenshots uploaded; pipeline lint and tests.
- `make setup | check | build | e2e | dev` from the repo root.

### Measured
| Measure | Value |
|---|---|
| Web unit tests | 32 passing, 5 files |
| Pipeline tests | 4 passing |
| Browser tests | 4 passing (desktop and phone viewport) |
| Built site | 4 files, 7.5 kB total (JS 4.1 kB, CSS 1.7 kB) |
| CI runs 1 and 2 | Success, 38 and 35 seconds |
| Deploy runs 1 and 2 | Failed, as expected (see below) |

### What failed
- The first deploy. Exact error from the run:
  "Get Pages site failed. Please verify that the repository has Pages enabled
  and configured to build using GitHub Actions". The build and size steps
  before it passed. This is item 1 under "Needs owner"; the workflow token
  cannot enable Pages itself. The workflow now detects this case and skips
  publishing with a warning instead of failing every push.

### Notes
- lightningcss (MPL-2.0) comes in through Vite as a build tool. It is not
  shipped in the site. Recorded as a flag in `docs/LICENSES.md`.

## Phase 1 plan: data pipeline

Goal: one command (`make assets`) that turns open source data into compact,
versioned web assets under `web/public/data/`, with a manifest and tests.

### Coordinate system
One local grid for everything: transverse Mercator centred on 30 degrees
east (`+proj=tmerc +lat_0=-2 +lon_0=30 +k=0.9999 +ellps=WGS84`), in metres.
Rwanda straddles two UTM zones, so a single custom grid avoids a seam and
keeps distortion under about 0.02% across the country.

### Domains
- Country: Rwanda plus a margin (about 28.6 to 31.1 east, 3.1 to 0.8 south)
  so the country does not float in empty space. Grid about 250 m.
- Kigali: a 30.72 km square at 30 m (1024 x 1024 cells), placed to hold the
  City of Kigali and the Nyabarongo and Nyabugogo valley floors. This is also
  the water simulation grid. A 60 m version (512 x 512) is derived for phones.

### Steps (one module each in `pipeline/src/hilltide_pipeline/`)
1. `download`: resumable downloads into `data/raw/`, each recorded with URL,
   size, hash and date. Re-running skips what is already there.
2. `terrain`: Copernicus GLO-90 tiles to the country grid, GLO-30 tiles to the
   Kigali grid. Reproject with rasterio, bilinear. Voids filled and counted.
3. `buildings`:
   - stream the Open Buildings v3 footprint file for the S2 cell holding
     Kigali, keep footprints inside the Kigali domain with confidence of at
     least 0.70 (Google's suggested cut for higher precision; the sensitivity
     to this choice is reported);
   - find and fetch the 2.5D Temporal GeoTIFFs (2016 to 2023) covering the
     domain; read only the needed windows;
   - per footprint and year: mean presence and median height inside the
     footprint. First year is the first year presence reaches 0.5 and stays
     at or above it afterwards. Footprints never reaching it are dropped and
     counted;
   - reduce each footprint to its minimum-area oriented rectangle (centre,
     width, length, angle) and keep the true footprint area for statistics;
   - compute per-year totals (count, footprint area) for the live statistics.
4. `osm`: from the Rwanda extract, take waterways (river, stream, canal),
   lakes and reservoirs, and a short list of place names. Clip, simplify with
   a tolerance tied to the grid size, reproject.
5. `border`: Rwanda outline from Natural Earth.
6. `landcover`: ESA WorldCover resampled to both grids as a small class map
   (water, forest, cropland, built-up, other) for terrain tint and for
   infiltration classes.
7. `pack`: compact binary formats with a documented header (magic, version,
   grid size, origin, cell size, scale, offset):
   - heights: 16-bit, row-delta coded, so the web server's compression works
     well on them;
   - buildings: per tile, quantized records (position 2 x 16 bit, width and
     length 8 bit each, angle 8 bit, first year 3 bit, heights 8 x 8 bit at
     0.5 m steps), sorted for good compression;
   - lines and polygons: quantized delta-coded coordinates.
8. `manifest`: `manifest.json` listing every asset with size, hash, format
   version, source data versions and attribution text. The site loads only
   through the manifest.

### Tests (synthetic fixtures, no downloads, run in CI)
- reprojection: known points map to known grid coordinates and back within
  1 m;
- clipping: features crossing the domain edge are cut correctly;
- packing: every format round-trips (heights exactly; buildings and lines
  within their stated quantization step);
- first-year rule: hand-made presence series give the expected year,
  including flicker and never-present cases;
- oriented rectangles: area and angle correct on rotated test shapes;
- manifest: sizes and hashes match the files on disk.

### Size budgets (to be replaced by measured values)
| Asset | Budget |
|---|---|
| Country terrain | 1.2 MB |
| Kigali terrain 30 m | 2.5 MB |
| Buildings, all tiles | 12 MB |
| Rivers, lakes, labels, border | 0.5 MB |
| Land cover, both grids | 0.6 MB |
| Loaded before first frame | 5 MB including code |

### Known unknowns to settle first
- The file layout and total size of the 2.5D Temporal GeoTIFFs for Kigali
  (read the bucket manifests before downloading anything large).
- The size of the v3 footprint file for Kigali's S2 cell (stream and filter;
  do not keep the whole file if it is many gigabytes).
- The exact credit text each source requires (read each license page and
  record it in `docs/LICENSES.md`).

### Done when
`make assets` rebuilds everything from `data/raw/`; pipeline tests pass in CI;
the manifest and measured sizes are recorded here; every dataset is verified
in `docs/LICENSES.md` with its attribution text.
