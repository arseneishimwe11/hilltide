# Hilltide: status

Last updated: 2026-11-16, end of Phase 3.

A new session can resume from `CLAUDE.md`, `docs/PROJECT_BRIEF.md` and this
file. Decisions are in `docs/DECISIONS.md`, licenses in `docs/LICENSES.md`.

## Where things stand

| Phase | State |
|---|---|
| 0 Foundations | Done |
| 1 Data pipeline | Done |
| 2 The Land | Done |
| 3 Kigali Builds Itself | Done |
| 4 Make It Rain | Next. Plan proposed below; waiting for the owner's approval. |
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

Browser graphics in the sandbox (and on GitHub's CI runners):
- WebGL2 works by default, with float render targets.
- WebGPU needs launch flags. The working set is in
  `web/playwright.config.ts` (`SOFTWARE_GRAPHICS`): Vulkan on SwiftShader.
  With `--use-webgpu-adapter=swiftshader` instead, the device is lost on
  the first frame.
- Everything is rendered on the CPU. Frame times measured here say nothing
  about a real GPU.

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

## Phase 2 report (The Land)

### What works
- The page opens on Rwanda from 365 km, drawn live, and scrolling flies the
  camera over Lake Kivu and the central hills down to Kigali.
- Three nested terrain levels (250 m, 90 m, 30 m) on WebGPU and on WebGL2,
  from the same shader code. The country level draws first; the other two
  load after the first frame, are prepared in a Web Worker, and have their
  shaders compiled before they appear.
- Light from the real sun position for the current time in Kigali
  (`web/src/sky/sun.ts`, tested against solstice, equinox and Kigali
  daylight), terrain self-shadows, sky, haze, water with reflection and sun
  glint, and a gentle Earth curvature.
- Night: a stylised moonlit view that says what it is, with a control for
  golden hour of the same day.
- Rwanda set apart from its neighbours from high altitude (border line,
  dimmed surroundings); mapped rivers drawn as water; 14 place labels.
- Loading state (title and drawn ridges) that fades to the live scene; a
  clear message for browsers with neither WebGPU nor WebGL2.
- Reduced motion: the camera cuts between five fixed views instead of flying.
- Wide screens frame the country beside the title; tall screens tilt the
  camera down so phones do not show half a screen of sky.
- Quality: three tiers, an initial guess from device hints, and an automatic
  scaler driven by measured frame times (resolution first, then tier).
  `?quality=low|medium|high` fixes a tier.
- `?perf=1`: an overlay with backend, GPU string, resolution, tier, frame
  time median and percentiles, hitch count, first-frame time and bytes, and
  a "Copy report" button. This is how to measure on real devices.
- Other address-bar options: `?backend=webgl2`, `?time=<ISO time>`,
  `?still` (cuts instead of flight).

### Measured
| Measure | Value |
|---|---|
| Web unit tests | 117 passing, 13 files |
| Pipeline tests | 73 passing |
| Browser tests | 22 passing: desktop and phone viewports, WebGL2 and WebGPU |
| Data before the first frame | 1.59 MB in 9 requests, uncompressed transfer (budget 5 MB) |
| Time to first frame, headless | 0.6 to 0.8 s on a local server |
| JavaScript bundle | 0.85 MB (0.23 MB gzipped) |
| Total site data | 12.09 MB in 114 assets |
| CI with the browser suite | 4 min 38 s on GitHub's runners (run 17, green) |

Screenshots at five scroll positions are saved by `make e2e` to
`web/test-results/screens/` and uploaded by CI as the "screenshots" artifact.
Each is checked to be a real picture (150 to 195 distinct quantised colours
and luminance contrast of 28 to 43, against about 30 colours for a blank
frame).

Frame times, headless software rendering (CPU rasteriser, 1120 x 700, medium
quality, continuous rendering). These are not real-device numbers:

| Backend | View | Median frame | 95th percentile |
|---|---|---|---|
| WebGL2 | From orbit | 17 ms | 933 ms |
| WebGL2 | Over Kigali | 17 ms | 1,517 ms |
| WebGPU | From orbit | 1,083 ms | 2,400 ms |
| WebGPU | Over Kigali | 1,100 ms | 2,400 ms |

The WebGL2 median is the browser's frame tick, not the cost of a frame: the
software rasteriser finishes frames late and in bursts, which the 95th
percentile shows. Real-device measurements: none yet (Needs owner 6).

### Not verified, stated plainly
- 60 fps on a laptop and 30 fps on a mid-range phone: cannot be measured
  here. The design choices aimed at them are in decisions 24, 25 and 31.
- No hitch over 100 ms while scrolling on desktop: levels are prepared in a
  worker and shaders are compiled before a level appears, but the upload of
  the 1280 x 1280 Kigali texture has not been timed on a real GPU.
- Safari and Firefox: only Chromium is available here.

### Limits to state on the site (Phase 6)
- Lighting relief is strengthened, especially from orbit; the land's shape
  is true scale (decision 27).
- The night view uses a stylised moon.
- Ground colours are land-cover classes mapped to a palette, not a
  satellite photograph.

### What failed or changed along the way
- `--use-webgpu-adapter=swiftshader` loses the WebGPU device; replaced by
  Vulkan SwiftShader flags (decision 32).
- Rivers and the border were planned as ribbon meshes; they became water
  cells and a distance mask (decisions 29 and 30).
- A hand-placed "Lake Muhazi" label was on dry land; the pipeline's check
  against land cover caught it.
- The first palette and haze washed out low views; slope shading and
  thinner haze near the ground fixed it.

## Phase 3 report (Kigali Builds Itself)

### What works
- Act 2 follows Act 1 on the same page. The camera drops to about 900 m
  above the ridges and moves round the south of the city while the years
  run from 2016 to 2023.
- All 825,495 dated buildings load (100 tiles, nearest the centre first)
  once the visitor is a third of the way through Act 1. Each is a box with
  the true footprint area, standing on the terrain, with its base sunk into
  slopes.
- The year drives every building's height on the GPU: a building rises
  from the ground during the year before the record first shows it, and
  glows in a warm tint for about a year and a half afterwards.
- Year control: a native slider (keyboard, touch, screen reader), Play and
  Pause, and figures for the City of Kigali read from the statistics file:
  buildings standing, added since 2016, footprint area. Between data years
  the figures are interpolated.
- The uncertainty is on the page, under the slider: growth by this method,
  the range across dating thresholds, and the rasters' own count. So is the
  number of buildings the device is actually drawing.
- Level of detail: tiles outside the view are skipped; far tiles draw only
  their largest buildings; a per-tier budget caps the total (150,000 low,
  350,000 medium, 600,000 high).
- Reduced motion: the camera cuts between views and years step one at a
  time, with no rising animation.
- New address-bar options: `?buildings=N` (cap buildings per frame),
  `?holdCamera` (keep the Act 1 end view through Act 2, to compare years).

### Measured
| Measure | Value |
|---|---|
| Web unit tests | 137 passing, 16 files |
| Pipeline tests | 73 passing |
| Browser tests | 31 passing, 5 skipped on the phone viewport (viewport-independent logic runs on desktop only) |
| JavaScript bundle | 0.87 MB (0.24 MB gzipped) |
| Data before the first frame | 1.59 MB (unchanged; buildings load later) |
| Building data | 7.92 MB, loaded in the background |
| On-screen figures | Equal to `buildings/stats.json` at 2016 and 2023 (tested) |
| Fixed view, 2016 to 2023 | 2.8% of scene pixels change on desktop, 6.1% on phone; returning to 2016 changes 0.00% |

Screenshots of the city at 2016, 2020 and 2023 on both backends and both
viewports are saved to `web/test-results/screens/city-*.png` and uploaded
by CI.

### Not verified, stated plainly
- Frame rate with real building budgets. The test machines rasterise on
  the CPU, so tests cap the buildings at 40,000. Whether 150,000 boxes hold
  30 fps on a mid-range phone, and 600,000 hold 60 fps on a laptop, can
  only be measured on those devices with `?perf=1`. The budgets are first
  estimates and are easy to change (`web/src/buildings/buildingLayer.ts`).
- Buildings pop in and out as the budget is shared out while the camera
  moves. Not yet judged on a real screen.

### Limits to state on the site (Phase 6), in addition to earlier ones
- Buildings are boxes with the footprint's area, not its exact outline.
- The 2016 count depends on how faint buildings are dated (already shown).
- On low and medium tiers not every mapped building is drawn (already shown).

### What failed or changed along the way
- The first building shader read the placed position where it needed the
  box's own 0 to 1 height, which blew the lighting out to white. Found by
  rendering each lighting term separately.
- Redrawing after every arriving tile (100 redraws) swamped the software
  renderer; tiles are now shown in batches at most every 350 ms.
- The first Act 2 camera was too high for buildings to read; it now flies
  about 900 m above the ridges.
- The high tier drew every building with no level of detail; it now has a
  budget like the others.

## Phase 4 plan proposal: Make It Rain (not yet approved)

Goal: a rainfall control that makes water run down the real terrain into
the valleys, simulated on the visitor's graphics chip, with tests that
prove the physics behaves.

1. One specification, three implementations (`web/src/water/`):
   - The method: local-inertial shallow water (Bates 2010, de Almeida
     2012). Water depth per cell and flow across each cell edge; Manning
     friction; a limiter so depth never goes negative; mass conserved by
     construction.
   - A plain TypeScript version on the CPU. It is the reference: the unit
     tests and the later validation runs use it.
   - WebGPU compute, and a WebGL2 version using float render targets.
     Browser tests compare both against the CPU reference on a small grid.
2. Inputs: the Kigali terrain grid (1280 x 1280 at 30 m; 640 x 640 at 60 m
   on the low tier, stated on screen); uniform rain in mm per hour; simple
   infiltration by land-cover class (little on built-up ground, none on
   water); water leaves freely at the grid's edges.
3. Tests required by the brief: mass conservation within a stated
   tolerance, still water stays still, water flows downhill on a tilted
   plane, outflow at the borders. Plus the GPU-against-CPU comparison.
4. Rendering: water drawn on the terrain with colour by depth, a wet edge,
   and movement that follows the flow; rain in the air while it falls.
5. Controls: rainfall slider in mm per hour; three presets (light rain,
   heavy storm, extreme storm) with their rates taken from a published
   source for Kigali rainfall, cited; play, pause, reset; simulated time
   and a running water balance (rained, soaked in, left the grid, on the
   ground).
6. The note on screen, always visible in this act: a picture of where
   water flows on this terrain, not a forecast or a warning; drains and
   culverts are not modelled; terrain cells are about 30 m. The claims
   guard gets its first allowlisted disclaimer.
7. Story: a third pinned act after Act 2, camera over the Nyabugogo valley.
8. Done when: the four physics tests and the GPU comparison pass in CI on
   both backends, screenshots show water in the valleys after a heavy
   storm, and headless numbers are recorded with the real-device slot left
   for the owner.

Known risk: the simulation is the heaviest thing in the project. Whether
1280 x 1280 runs at a useful speed on integrated graphics is unknown until
measured on real devices; the 640 x 640 grid is the fallback.
