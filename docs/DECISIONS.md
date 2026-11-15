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
