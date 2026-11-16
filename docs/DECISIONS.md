# Decisions

One short entry per significant decision: what was decided, what else was
considered, and why. Newest at the bottom.

## 1. Work directly on `main`
- Decision: commit and push to `main`; no feature branches for solo phase work.
- Alternatives: the session's default `claude/...` branch with pull requests.
- Reason: the standing instructions allow pushes to main, GitHub Pages deploys
  from the default branch, and the repo started empty so `main` had to exist
  first. The owner approved this in the plan.

## 2. Repository layout: `web/` and `pipeline/` side by side
- Decision: the site is an npm package in `web/`, the data pipeline a uv
  project in `pipeline/`, with a root `Makefile` as the single entry point.
- Alternatives: web app at the repo root; a monorepo tool.
- Reason: two toolchains with nothing shared but data files. Keeping each in
  its own folder keeps CI jobs, caches and lockfiles independent and simple.

## 3. Vite, strict TypeScript, no UI framework
- Decision: Vite for the build, TypeScript in strict mode, plain DOM code for
  the interface, a small typed message catalog for all text.
- Alternatives: React or Preact; Next or Astro.
- Reason: the page is one full-screen 3D canvas with a thin layer of text and
  a few controls. A framework would add weight to the first-frame budget
  (about 5 MB including data) without removing much code.

## 4. Biome instead of ESLint and Prettier
- Decision: Biome for linting and formatting.
- Alternatives: ESLint with typescript-eslint, plus Prettier.
- Reason: the project uses TypeScript 7, whose compiler is a new native
  implementation; lint tools built on the old compiler API are a compatibility
  risk. Biome is one fast tool with no such dependency.

## 5. Relative base path for the build
- Decision: Vite `base: "./"`.
- Alternatives: hard-code `/hilltide/`.
- Reason: the same build works on GitHub Pages under `/hilltide/`, on a custom
  domain at `/`, and from a local preview, with no configuration.

## 6. Static HTML text comes from the message catalog
- Decision: a small Vite plugin fills `%t:key%` tokens in `index.html` from
  `en.json` at build time.
- Alternatives: write title and description by hand in `index.html`.
- Reason: one source of text, so translation and the no-forecast-claims check
  cover the page title, description and social tags too.

## 7. Forecast-claims guard uses an allowlist, not only pattern matching
- Decision: any message using forecast or warning vocabulary fails the test
  unless its key is in a reviewed allowlist and the sentence is a negation.
- Alternatives: a plain banned-phrase list.
- Reason: the site must state "this is not a forecast", so the vocabulary
  cannot simply be banned. Requiring an explicit allowlist entry makes every
  such sentence a deliberate, reviewed choice.

## 8. three.js as the 3D engine (added in Phase 2)
- Decision: three.js with its WebGPU renderer and WebGL2 backend.
- Alternatives: Babylon.js; raw WebGPU and WebGL2 written twice.
- Reason: MIT license, one scene code path for both backends, small enough
  for the first-frame budget, and the widest pool of people who can read it.

## 9. Own flow-accumulation code in the pipeline
- Decision: write priority-flood and D8 flow accumulation ourselves.
- Alternatives: pysheds, richdem.
- Reason: both are GPL-3.0. The algorithms are short and well documented, and
  our own version can be unit-tested against hand-made terrains.

## 10. Hilltide's own code license is left to the owner
- Decision: no LICENSE file for the project's code yet; packages are marked
  unlicensed. Listed under "Needs owner".
- Alternatives: pick MIT now.
- Reason: licensing the code grants rights to the public on the owner's
  behalf. That is the owner's choice, not an engineering decision.

## 11. Commit author identity
- Decision: keep the sandbox's git identity (Claude, noreply address).
- Alternatives: commit under the owner's name and email.
- Reason: putting the owner's email into public commit history is not
  something to do without being asked. Easy to change for future commits.

## 12. Playwright pinned to the sandbox's browser version
- Decision: `@playwright/test` pinned to 1.63.0.
- Alternatives: track the latest release.
- Reason: the sandbox ships a matching Chromium and cannot use another
  version. CI installs the same pinned version's browser, so local and CI
  screenshots come from the same engine.

## 13. One local grid: transverse Mercator centred on 30 E
- Decision: all data is reprojected to a custom transverse Mercator
  (`+proj=tmerc +lat_0=-2 +lon_0=30 +k=0.9999`), in metres.
- Alternatives: UTM zone 35S or 36S; Web Mercator.
- Reason: Rwanda straddles the 30 E line between two UTM zones, and Kigali
  sits on it. One custom grid has no seam and keeps distance error under
  0.05% across the country (tested).

## 14. Three terrain levels
- Decision: country at 250 m (1120 x 1024), region around Kigali at 90 m
  (1024 x 1024), Kigali at 30 m (1280 x 1280).
- Alternatives: two levels; a tile pyramid.
- Reason: 250 m is enough from high altitude and fits the first-frame
  budget (1.05 MB). The dive across the hills needs something between
  250 m and 30 m, which the 90 m region provides. Three fixed grids are far
  simpler to load and test than a pyramid at this scale.

## 15. The Kigali grid covers the whole City of Kigali
- Decision: a 38.4 km square (1280 x 1280 cells at 30 m), placed around the
  city's administrative boundary with at least 2.5 km of margin.
- Alternatives: a 30.72 km square (1024 x 1024), which held 88% of the city.
- Reason: statistics can be stated for the official City of Kigali, and the
  Nyabarongo valley on the city's edge is inside the water simulation. The
  cost is 56% more simulation cells; weaker devices use the 60 m version.

## 16. Self-compressed asset container
- Decision: every binary asset is a small container (`HLT1`: JSON header
  plus gzip-compressed sections) that the browser unpacks itself.
- Alternatives: rely on the web server to compress; PNG-encoded heights;
  an existing format such as Zarr or GeoTIFF.
- Reason: GitHub Pages does not compress arbitrary binary files, browsers
  cannot decode 16-bit PNGs through canvas, and general formats need large
  client libraries. One tiny reader covers heights, buildings and lines.

## 17. Lakes from land cover, rivers from OpenStreetMap
- Decision: lakes come from ESA WorldCover's water class; rivers, borders
  and place names from an OSM extract.
- Alternatives: lakes from OSM; borders from Natural Earth.
- Reason: the Rwanda OSM extract stops at the border and cuts Lake Kivu in
  half. WorldCover covers the neighbours too. OSM's border is far more
  detailed than Natural Earth's, so Natural Earth is not used at all.

## 18. Building rasters read at their 4 m overview level
- Decision: read the 4 m overview of each 0.5 m Open Buildings 2.5D
  Temporal file over HTTP, for the windows covering Kigali only.
- Alternatives: download the full files (about 800 MB each, 25 per year).
- Reason: the publisher states the effective resolution is about 4 m, so
  the overview loses nothing real, and 160 GB of downloads become 2 GB.

## 19. Buildings are dated against their own final presence
- Decision: a footprint counts as present in a year when its mean presence
  is at least half of its own final level (the larger of 2022 and 2023).
  Its first year is the earliest year from which it is present in at least
  three quarters of the remaining years. Footprints whose final presence is
  below 0.2 cannot be dated and are left out (and counted).
- Alternatives: a fixed presence threshold of 0.5 for every footprint.
- Reason: measured on Kigali, a fixed 0.5 marks only about a third of
  footprints as present in 2023, because small houses are blurred in the
  Sentinel-2 based rasters. Relative to its own final level, the 2016
  presence of footprints forms two clear groups (about 21% near zero, the
  rest near one) with a valley between 0.2 and 0.5. The rule was fixed from
  this distribution, before any validation list of known developments
  existed.

## 20. Footprint confidence threshold 0.683
- Decision: use footprints with confidence of at least 0.683, the value
  Google publishes for 85% precision in this region's S2 cell.
- Alternatives: 0.650 (80% precision) or 0.738 (90%).
- Reason: a published, region-specific value rather than a round number.
  The temporal rasters act as a second, independent filter. Counts at all
  three thresholds are written to `buildings/stats.json`.

## 21. Buildings stored as area-preserving rectangles, largest first
- Decision: each building is an oriented rectangle with the footprint's
  true area, in 3.84 km tiles, sorted by area within a tile.
- Alternatives: full footprint polygons; a single file.
- Reason: about 14 bytes per building instead of a polygon, one instanced
  draw call per tile, and drawing only the first N of a tile is a free
  level of detail for phones. Keeping the true area keeps the built-up
  total honest for L-shaped buildings.

## 22. The dating threshold stays at 0.5; its sensitivity is published
- Decision: keep the presence threshold at half of a footprint's final
  level, and publish how the 2016 count moves with it (36.6% growth at 0.3,
  53.3% at 0.5, 84.1% at 0.7) next to the rasters' own count (+36%).
- Alternatives: lower the threshold to 0.3, where footprint growth happens
  to match the rasters' own count growth.
- Reason: moving a parameter after seeing which value gives the more
  comfortable headline is tuning. Neither figure is ground truth: at 0.3
  the threshold falls below the rasters' year-to-year noise for faint
  buildings, which dates new buildings too early; at 0.5 noise can date old
  ones too late. Large buildings, whose signal is clean, show 40% to 44%.
  The honest position is the central rule plus its stated range. Revisit
  only with evidence from the non-held-out validation developments.

## 23. One phase per approved plan
- Decision: at the end of each phase, stop and present the next phase's
  plan to the owner for approval before building it.
- Alternatives: plan each phase in writing and continue without pausing.
- Reason: the owner enters plan mode for each phase. Phase 1 was built
  under an earlier plan that said to continue without pausing.

## 24. Terrain is one float texture per level, read with exact texel fetches
- Decision: each level is an RGBA float texture (height, east slope, north
  slope, land-cover class). Shaders fetch four texels and blend them by hand.
- Alternatives: filtered float textures; 16-bit heights in two 8-bit
  channels; normal maps; heights baked into mesh vertices.
- Reason: texel fetches need no optional device features, so the same
  shader runs on WebGL2 and WebGPU, phones included. Height and slope in one
  texel give a smooth surface and smooth lighting from a single read.

## 25. One simple mesh per level; detail comes from per-pixel shading
- Decision: each level is drawn with one flat grid (192, 320 or 512 quads a
  side by quality tier) lifted in the vertex shader. Slope, colour, shadow
  and haze are computed per pixel from the texture.
- Alternatives: chunked level of detail; clipmaps.
- Reason: at these distances the eye reads relief from light, not from the
  silhouette. A coarse mesh with per-pixel normals looks detailed and costs
  little, which is what makes the phone budget reachable. Far simpler too.

## 26. Levels overlap and the coarse one steps aside
- Decision: a finer level follows its parent's surface in a band along its
  edge; the parent discards pixels further inside than half that band.
- Alternatives: stitched meshes; skirts.
- Reason: no cracks and no flicker, with no geometry bookkeeping. In the
  overlap both levels show the same surface.

## 27. Lighting relief is strengthened; the shape of the land never is
- Decision: terrain geometry is always true scale. The slope used for
  lighting is multiplied by 3.6 from orbit, falling to 1.3 near the ground,
  and steep ground is darkened a little whichever way it faces.
- Alternatives: true lighting everywhere; vertical exaggeration.
- Reason: from 365 km true relief is invisible, and at midday true lighting
  flattens hills. This is the convention of shaded relief maps. The site's
  limits section must say so (Phase 6).

## 28. Night uses a stylised moon, and says so
- Decision: when the sun is more than 4 degrees below the horizon the scene
  is lit by a moon placed opposite the sun's bearing, and the page shows
  "Night view, with stylised moonlight". A control offers golden hour.
- Alternatives: real moon position and phase; refuse to show night.
- Reason: half of all visits fall in Kigali's night. The land must stay
  legible, and the page must not pretend the light is real when it is not.

## 29. Rivers are marked as water in the terrain's class grid
- Decision: mapped rivers (and canals in Kigali) are burned into each
  level's land-cover grid as water cells when the level is prepared.
- Alternatives: separate ribbon meshes draped over the terrain.
- Reason: they follow the land exactly at every level, share the water
  shading, and need no extra geometry or height lookups. Streams and drains
  are left out: at 30 m cells they would be drawn far wider than they are.

## 30. Rwanda is set apart with a distance-to-border mask
- Decision: a 1 km grid of signed distance to the border drives a pale
  border line, dimmed neighbours and a fade to darkness, all only from high
  altitude.
- Alternatives: a border ribbon mesh; a hard rectangular edge.
- Reason: the terrain grid is a rectangle that includes parts of four
  neighbours. The mask shows the country as a shape for 24 kB.

## 31. Frames are drawn only when something changed
- Decision: the scene renders when the camera moves, data arrives, the
  light changes or the window resizes. `?perf=1` renders continuously.
- Alternatives: render every frame.
- Reason: Act 1 is still most of the time. Idle rendering drains phone
  batteries for nothing. Later acts with moving water will render
  continuously while they play.

## 32. Headless browsers use Vulkan SwiftShader for WebGPU
- Decision: tests launch Chromium with `--enable-features=Vulkan
  --use-vulkan=swiftshader --use-angle=swiftshader --enable-unsafe-webgpu
  --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
- Alternatives: `--use-webgpu-adapter=swiftshader`.
- Reason: with the alternative flag the WebGPU device is lost on the first
  frame. With these, rendering and compute both work, here and on GitHub's
  runners, so both backends are tested on every push.

## 33. Buildings are instanced boxes; the year is a pair of weight vectors
- Decision: every building is the same unit box, drawn once per tile with
  per-building attributes (place, shape, eight yearly heights in bytes). The
  shader's height is the dot product of those eight heights with eight
  weights computed on the CPU for the slider's year.
- Alternatives: rebuild meshes when the year changes; a height texture
  indexed by year; one draw call for the whole city.
- Reason: moving the slider changes two small uniforms and nothing else, so
  it costs nothing per building. Because heights are zero before a
  building's first year, the same sum makes it rise during the year before
  it appears, with no special case.

## 34. Level of detail by drawing the first N buildings of each tile
- Decision: tiles outside the view are skipped; a tile draws all its
  buildings when near and a share that falls with the square of distance
  when far; if the total exceeds the device's budget, all tiles are scaled
  down together. Budgets: 150,000 (low), 350,000 (medium), 600,000 (high).
- Alternatives: merged far-distance meshes; impostors; drawing everything.
- Reason: the pipeline already stores each tile largest building first, so
  "the first N" is always the N that matter most at that distance, and the
  whole scheme is one integer per tile. The budgets are estimates until
  measured on real devices; the page states how many it is drawing.

## 35. Building bases are sunk into slopes
- Decision: each box's base is lowered by the terrain's drop across half
  the building (at most 12 m); the roof stays at ground plus height.
- Alternatives: flat base at centre height; per-corner ground heights.
- Reason: Kigali is built on slopes. A flat base leaves the downhill edge
  hanging in the air; this costs one number per building.

## 36. The year follows the scroll; the slider and Play move the scroll
- Decision: in Act 2 the year is a function of scroll position. Dragging
  the slider or pressing Play scrolls the page to the matching position.
- Alternatives: an independent year state beside the scroll.
- Reason: one source of truth. The camera, the text and the year can never
  disagree, and the browser's own scroll gives touch, wheel and keyboard
  control for free. Any scroll input by the visitor stops Play.

## 37. Counts on screen are for the City of Kigali, with the uncertainty beside them
- Decision: the figures use the official city boundary (not the whole
  38 km grid), and the sentence under the slider gives the growth range
  across dating thresholds and the rasters' own count.
- Alternatives: grid totals; a single headline number.
- Reason: "City of Kigali" is a defined place a reader can check. The
  2016 count is uncertain (decision 22), and the page should say so where
  the number is shown, not in a footnote.

## 38. Tests cap the buildings drawn
- Decision: `?buildings=N` limits buildings per frame. Browser tests use
  40,000 (15,000 for the flight test).
- Alternatives: test at the real budgets.
- Reason: the test machines rasterise on the CPU; 350,000 boxes take tens
  of seconds per frame there. The cap changes how many are drawn, not how
  they are drawn. Real budgets need real devices.

