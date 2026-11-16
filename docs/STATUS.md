# Hilltide: status

Last updated: 2026-11-16, end of Phase 1, start of Phase 2.

A new session can resume from `CLAUDE.md`, `docs/PROJECT_BRIEF.md` and this
file. Decisions are in `docs/DECISIONS.md`, licenses in `docs/LICENSES.md`.

## Where things stand

| Phase | State |
|---|---|
| 0 Foundations | Done |
| 1 Data pipeline | Done |
| 2 The Land | In progress (plan below) |
| 3 Kigali Builds Itself | Not started. Plan to be approved by the owner first. |
| 4 Make It Rain | Not started |
| 5 Validation | Not started |
| 6 Story and design | Not started |
| 7 Capture mode | Not started |
| 8 Performance and release | Not started |

Working agreement with the owner: one phase per approved plan. At the end
of each phase, stop and present the next phase's plan for approval.

## Needs owner

Things only the owner can do. None of them block the current phase.

1. **Enable GitHub Pages.** Repository Settings > Pages > Build and
   deployment > Source: choose "GitHub Actions". Until then the Deploy
   workflow builds the site, shows a "Not deployed" warning and skips
   publishing. After enabling, re-run the Deploy workflow from the Actions
   tab (or it runs on the next push). The repo is public, so Pages is free.
   Expected address: `https://arseneishimwe11.github.io/hilltide/`.
2. **Choose a license for Hilltide's own code** (for example MIT). Until
   chosen there is no LICENSE file, which means all rights reserved.
3. **Fill in `site.config.json`**: creator name, links, and the site URL once
   Pages is live. The page hides the credit line while the name is still the
   placeholder.
4. **Commit author.** Commits are authored as "Claude" with a noreply
   address. Say so if you want your own name and email on future commits.
5. **Copernicus DEM commercial terms.** Free public use with a credit line is
   confirmed. Whether commercial use is allowed could not be confirmed from
   the sandbox (the licence PDF host refuses connections). Check before
   building a commercial product on this terrain data.
6. Later phases will add: test on your phone and laptop with `?perf=1`,
   review Kinyarwanda strings with a native speaker, re-export the clips on
   a real GPU.

## Sandbox (measured)

| Item | Value |
|---|---|
| CPU | 4 cores |
| RAM | 15 GB |
| Disk free | 24 GB after Phase 1 (raw cache 3.7 GB, work files 1.5 GB) |
| GPU | None. Headless Chromium renders in software (SwiftShader). |
| Tools | Node 22.23, npm 10.9, Python 3.13, uv 0.11, ffmpeg 6.1. No GDAL (rasterio wheels bundle it). |
| Browser | Chromium for Playwright 1.63.0, pre-installed |
| Network | Unrestricted, through a proxy |

Browser graphics in the sandbox:
- WebGL2 works by default, with float render targets.
- WebGPU returns no adapter by default. With the launch flags
  `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader
  --enable-unsafe-swiftshader --use-angle=swiftshader --ignore-gpu-blocklist`
  an adapter and device are created.
- A three.js 0.187 smoke test rendered correctly and ran a compute pass on
  its WebGL2 backend. On its WebGPU backend the device was lost ("Instance
  dropped"). Not yet investigated; first task of Phase 2.

Reachable: Copernicus DEM on S3, Google Open Buildings buckets, ESA
WorldCover on S3, openstreetmap.fr extracts, npm, PyPI.
Not reachable: `download.geofabrik.de`, Overpass servers,
`spacedata.copernicus.eu`.

## Phase 0 report (foundations)

- The four owner files exist exactly as specified.
- `web/`: Vite 8, TypeScript 7 (strict), Biome, Vitest, Playwright. All text
  in a typed message catalog (`web/src/i18n/en.json`).
- A test that fails if site text claims to forecast or warn about floods
  (`web/src/i18n/claimsGuard.ts`), also run against the rendered page.
- `pipeline/`: uv project, ruff, pytest.
- Site size guard (`scripts/check-site-size.mjs`): no file over 50 MB, total
  under 100 MB.
- CI on every push (about 40 seconds at the end of Phase 0). Deploy workflow
  ready, waiting on Pages (Needs owner 1).
- `make setup | check | assets | build | e2e | dev` from the repo root.

## Phase 1 report (data pipeline)

### What works
- One command rebuilds every web asset from the raw cache:
  `make assets` (3 min 8 s from cache; first run also downloads about 3.7 GB).
  A second run produces byte-identical files.
- Steps (`pipeline/src/hilltide_pipeline/steps.py`): `terrain`, `osm`,
  `landcover`, `buildings`, then `verify` checks every file against the
  manifest.
- Every asset is listed in `web/public/data/manifest.json` with size, hash,
  sources and each source's required credit text.
- Browser-side readers for every asset kind in `web/src/data/`, tested
  against the committed files, so the two sides of the format cannot drift.
- Tests: 67 pipeline tests (reprojection, clipping, packing round-trips,
  dating rule, tiles, OSM reading from a synthetic extract, flow
  accumulation, manifest) and 69 web unit tests.

### Assets (112 files, 12.06 MB)
| Asset | Detail | Size |
|---|---|---|
| Terrain, country | 250 m, 1120 x 1024, 789 to 4,444 m | 1.05 MB |
| Terrain, region | 90 m, 1024 x 1024 around Kigali | 0.83 MB |
| Terrain, Kigali | 30 m, 1280 x 1280 (38.4 km), 1,331 to 2,218 m | 1.36 MB |
| Buildings | 825,495 buildings in 100 tiles of 3.84 km, plus statistics | 7.92 MB |
| Land cover | ESA WorldCover classes on all three grids | 0.81 MB |
| Rivers, borders, labels | 661 country rivers (3,744 km), 713 Kigali waterways (1,002 km), Rwanda border, City of Kigali boundary, 152 place names | 0.09 MB |

Needed before the first frame (country terrain, country land cover, border,
country rivers, manifest): about 1.3 MB.

### Buildings: measured
- 22,106,220 published footprints read, equal to Google's published count
  for that file. 1,042,434 fall on the Kigali grid.
- 945,002 have confidence of at least 0.683 (Google's published value for
  85% precision in this region). Of those: 825,495 dated, 115,174 too faint
  in the yearly rasters to date, 4,333 not steadily present.
- City of Kigali (official boundary, 737.5 km2), buildings standing:

  | Year | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 |
  |---|---|---|---|---|---|---|---|---|
  | Buildings | 386,212 | 424,313 | 450,129 | 477,544 | 503,172 | 540,386 | 577,618 | 592,167 |
  | Footprint area, km2 | 31.3 | 33.5 | 35.0 | 36.6 | 38.2 | 40.6 | 42.7 | 43.5 |

- The same city from the yearly rasters alone, without footprints (sum of
  fractional building counts; area with presence of at least 0.5):

  | Year | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 |
  |---|---|---|---|---|---|---|---|---|
  | Count estimate | 538,355 | 544,056 | 593,080 | 615,265 | 615,066 | 667,342 | 728,214 | 732,606 |
  | Built area, km2 | 24.9 | 27.7 | 30.5 | 31.0 | 31.4 | 34.0 | 34.8 | 36.6 |

### Known weakness: growth depends on the dating threshold
Growth in the city from 2016 to 2023 is +53% by our method and +36% by the
rasters' own count. The 2023 total is stable, the 2016 total is not:

| Presence threshold (share of a footprint's final level) | 2016 | 2023 | Growth |
|---|---|---|---|
| 0.3 | 435,075 | 594,322 | +36.6% |
| 0.5 (used) | 386,212 | 592,167 | +53.3% |
| 0.7 | 316,561 | 582,647 | +84.1% |

Likely reason: small houses give a faint, noisy signal in the Sentinel-2
based rasters (year-to-year noise about 0.12 against final levels of 0.2 to
0.5), so their first year is uncertain in both directions. For large
buildings (150 m2 and more) the signal is clean and growth is 40% to 44%
whichever threshold is used. The threshold was kept as decided before these
figures were seen (decisions 19 and 22). The table is written to
`buildings/stats.json` and the site will show it. Phase 5 checks the dating
against known developments.

### Other limits to state on the site
- Building heights were evaluated by Google only in North America, Europe
  and Japan; presence values are uncalibrated.
- Buildings are drawn as rectangles with the true footprint area.
- Buildings demolished before the footprint imagery was taken are absent.
- The terrain is a surface model: it includes tree canopy and roofs.
- Rivers entering the Kigali grid from outside (the Nyabarongo) carry no
  upstream water in the later simulation.

### What failed or changed along the way
- Geofabrik and Overpass are unreachable from the sandbox; openstreetmap.fr
  is used instead.
- Reprojecting DEM tiles one by one left a seam at the 30 E tile edge,
  which runs through Kigali. Fixed by mosaicking first; covered by a test.
- A fixed presence threshold of 0.5 dated only a third of footprints; the
  rule became relative to each footprint's own final level (decision 19).
- The first Kigali grid (30.72 km) held 88% of the city; enlarged to
  38.4 km (decision 15).
- Natural Earth is not used; the OSM border is better.

## Phase 2 plan: The Land (approved 2026-11-16)

Goal: the page opens on Rwanda from high altitude in live 3D within a few
seconds; scrolling flies the camera across the hills to Kigali, lit by the
real sun position for the current time in Kigali.

Architecture, under `web/src/`:
- `core/renderer.ts`: three.js `WebGPURenderer`; WebGPU when available, else
  its WebGL2 backend (`?backend=webgl2` forces it). Clear static message if
  neither works.
- `core/quality.ts`: three tiers and an automatic scaler from measured frame
  times (pixel ratio, mesh density, shadow steps).
- `perf/`: frame-time recorder and a `?perf=1` overlay (device, backend, GPU
  string, resolution, tier, median and percentile frame times, hitches).
- `terrain/`: three nested levels. Heights as float textures read with texel
  fetches; grid chunks displaced in the vertex shader, coarser with
  distance; per-pixel normals from the height texture; coarse level cut away
  inside the finer one, finer level blended to coarse at its edge. Colour
  from land cover and elevation in the place palette; lakes from the water
  class. Sun from `sky/sun.ts`, self-shadow by marching the height texture,
  sky gradient with sun disc, haze, gentle Earth curvature. Moonlit look at
  night with a "Now in Kigali HH:MM" control and a golden-hour option.
- `terrain/overlays`: rivers and border as draped ribbons; a few HTML labels.
- `story/`: scroll to chapter progress, keyframed camera path with damping;
  cuts instead of flight under reduced motion.
- Loading: the title page is the loading state and cross-fades to the scene
  after the first frame. Region and Kigali levels load as the scroll
  approaches, decoded in a Web Worker.

Order of work, each step committed and pushed:
1. Renderer, backend selection, perf overlay, browser tests with software-GL
   flags; resolve or document the WebGPU device loss.
2. Country level lit by the real sun, sky and haze; loading state;
   first-frame budget test (fails above 5 MB).
3. Three nested levels with worker-based progressive loading.
4. Scroll-driven dive with chapter text skeleton and reduced motion.
5. Rivers, border, lakes, labels, night handling.
6. Automatic quality scaling; measurements; Phase 2 report here.

Done when: browser tests on desktop and phone viewports save real (non
blank) screenshots at five scroll positions with no console errors; unit
tests cover camera path, scroll mapping, quality scaler, frame statistics
and label projection; headless frame times are recorded here, labelled as
software rendering; CI is green.

Then stop and present the Phase 3 plan for approval.
