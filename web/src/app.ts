import { Matrix4, Scene } from "three/webgpu";
import { BUILDING_BUDGETS, BuildingLayer } from "./buildings/buildingLayer";
import { t } from "./core/i18n";
import { initialTier, QualityScaler, type QualityState, TIERS, type Tier } from "./core/quality";
import { createRenderer, graphicsSupport, type RenderContext } from "./core/renderer";
import { siteConfig } from "./core/siteConfig";
import type { BuildingStats } from "./data/buildings";
import { AssetLoader } from "./data/manifest";
import { decodeMask } from "./data/mask";
import { FrameStats, type FrameSummary } from "./perf/frameStats";
import { PerfOverlay, type PerfReport } from "./perf/overlay";
import { lightingFor } from "./sky/lighting";
import { clockTime, goldenHour, KIGALI, sunDirection, sunPosition } from "./sky/sun";
import {
  type CameraKey,
  type CameraPose,
  dampPose,
  keepAboveGround,
  nearestKeyTime,
  poseDistance,
  samplePath,
  shiftBesideText,
  tiltForPortrait,
} from "./story/cameraPath";
import {
  CITY_CHAPTERS,
  CITY_KEYS,
  FIRST_YEAR,
  LAST_YEAR,
  progressForYear,
  yearForProgress,
} from "./story/cityStory";
import { KIGALI_CENTRE, LAND_CHAPTERS, LAND_KEYS } from "./story/landStory";
import { scrollForProgress, sectionProgress } from "./story/scroll";
import { LandScene } from "./terrain/landScene";
import { type LevelName, TerrainLoader } from "./terrain/terrainLoader";
import { EARTH_RADIUS } from "./terrain/terrainMaterial";
import { LabelLayer, type PlaceLabel } from "./ui/labelLayer";
import { StoryView } from "./ui/storyView";

/** What the page exposes for tests and for measuring on real devices. */
export interface HilltideState {
  ready: boolean;
  failed: string | null;
  backend: string;
  gpu: string;
  softwareRenderer: boolean;
  /** Progress through Act 1, 0 to 1. */
  progress: number;
  /** Progress through Act 2, 0 to 1. */
  cityProgress: number;
  /** The year shown in Act 2, possibly between two data years. */
  year: number;
  /** True when the camera has arrived and nothing is still loading. */
  settled: boolean;
  levels: LevelName[];
  quality: QualityState;
  renderedFrames: number;
  /** Time and downloaded bytes up to the first live frame; null until then. */
  firstFrame: { ms: number; bytes: number; requests: number } | null;
  /** Buildings loaded, mapped in total, and drawn in the latest frame. */
  buildings: { loaded: number; total: number; drawn: number };
  frames(): FrameSummary;
  scrollToProgress(progress: number): void;
  scrollToCity(progress: number): void;
  scrollToYear(year: number): void;
}

declare global {
  interface Window {
    __hilltide?: HilltideState;
  }
}

/** Metres the camera is kept above the ground beneath it. */
const CAMERA_CLEARANCE = 350;
/** Seconds for the camera to cover half the remaining distance to where the scroll points. */
const CAMERA_HALF_LIFE = 0.16;
/** How often the live sun position is refreshed, in milliseconds. */
const SUN_REFRESH_MS = 20_000;
/** Buildings start loading once the visitor is this far into Act 1. */
const BUILDINGS_FROM_PROGRESS = 0.35;
/** Buildings are drawn below this altitude factor (0 near the ground, 1 from orbit). */
const BUILDINGS_BELOW_ALTITUDE = 0.3;
/** While building tiles arrive, the scene is redrawn at most this often, in milliseconds. */
const TILE_REDRAW_MS = 350;
/** Seconds each year takes when the year control plays by itself. */
const SECONDS_PER_YEAR = 1.7;

/** Everything downloaded so far (the page itself, code, data), from the browser's own records. */
function measureFirstFrame(): { ms: number; bytes: number; requests: number } {
  const entries = [
    ...performance.getEntriesByType("navigation"),
    ...performance.getEntriesByType("resource"),
  ] as PerformanceResourceTiming[];
  const bytes = entries.reduce(
    (sum, entry) => sum + (entry.transferSize > 0 ? entry.transferSize : entry.encodedBodySize),
    0,
  );
  return { ms: Math.round(performance.now()), bytes, requests: entries.length };
}

function isTier(value: string | null): value is Tier {
  return value === "low" || value === "medium" || value === "high";
}

export async function startApp(root: HTMLElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const reducedMotion =
    params.has("still") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = new StoryView(
    root,
    { land: LAND_CHAPTERS, city: CITY_CHAPTERS },
    { first: FIRST_YEAR, last: LAST_YEAR },
    siteConfig,
  );

  const scrollInto = (section: HTMLElement, progress: number): void => {
    window.scrollTo(
      0,
      scrollForProgress(progress, section.offsetTop, section.offsetHeight, window.innerHeight),
    );
  };
  const stats = new FrameStats();
  const state: HilltideState = {
    ready: false,
    failed: null,
    backend: "",
    gpu: "",
    softwareRenderer: false,
    progress: 0,
    cityProgress: 0,
    year: FIRST_YEAR,
    settled: false,
    levels: [],
    quality: { tier: "medium", resolutionScale: 1 },
    renderedFrames: 0,
    firstFrame: null,
    buildings: { loaded: 0, total: 0, drawn: 0 },
    frames: () => stats.summary(),
    scrollToProgress: (progress) => scrollInto(view.landSection, progress),
    scrollToCity: (progress) => scrollInto(view.citySection, progress),
    scrollToYear: (year) => scrollInto(view.citySection, progressForYear(year)),
  };
  window.__hilltide = state;

  const support = graphicsSupport();
  if (!support.webgpu && !support.webgl2) {
    state.failed = "unsupported";
    view.fail(t("unsupported.body"), t("unsupported.title"));
    return;
  }

  let dirty = true;
  const requestRender = (): void => {
    dirty = true;
  };
  let context: RenderContext;
  let land: LandScene;
  let assets: AssetLoader;
  let loader: TerrainLoader;
  let labels: LabelLayer | null = null;
  try {
    assets = await AssetLoader.open(`${import.meta.env.BASE_URL}data/`);
    loader = new TerrainLoader(assets);
    const forceWebGL = params.get("backend") === "webgl2";
    const [created, country, mask] = await Promise.all([
      createRenderer(view.canvas, { forceWebGL }),
      loader.load("country"),
      assets.bytes("border.mask").then(decodeMask),
    ]);
    context = created;
    state.backend = context.backend;
    state.gpu = context.gpu;
    state.softwareRenderer = context.softwareRenderer;

    const requested = params.get("quality");
    const tier = isTier(requested)
      ? requested
      : initialTier({
          memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          cores: navigator.hardwareConcurrency,
          isMobile: window.matchMedia("(pointer: coarse)").matches,
          softwareRenderer: context.softwareRenderer,
        });
    state.quality = { tier, resolutionScale: 1 };
    land = new LandScene(TIERS[tier], mask);
    await land.addLevel("country", country);
    // Labels are a nicety: the scene starts without waiting for them.
    void assets
      .json<PlaceLabel[]>("labels.curated")
      .then((list) => {
        labels = new LabelLayer(root, view.canvas.nextElementSibling, list);
        requestRender();
      })
      .catch((error) => console.error(error));
  } catch (error) {
    console.error(error);
    state.failed = String(error);
    view.fail(t("loading.failed"));
    return;
  }

  const { renderer } = context;
  // A fixed quality (from the address bar) is never changed automatically.
  const scaler = isTier(params.get("quality"))
    ? null
    : new QualityScaler(state.quality.tier, { ceiling: state.quality.tier });
  const perf = params.has("perf") ? new PerfOverlay(root) : null;

  // --- Size and resolution ----------------------------------------------------
  const applySize = (): void => {
    const settings = TIERS[state.quality.tier];
    const ratio =
      Math.min(window.devicePixelRatio || 1, settings.pixelRatioCap) *
      state.quality.resolutionScale;
    renderer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    requestRender();
  };
  applySize();
  window.addEventListener("resize", applySize);

  // --- Sun ----------------------------------------------------------------------
  const fixedTime = params.get("time");
  let sunMode: "live" | "golden" = "live";
  const sunMoment = (): Date => {
    const now = fixedTime === null ? new Date() : new Date(fixedTime);
    return sunMode === "golden" ? goldenHour(now, KIGALI.latitude, KIGALI.longitude) : now;
  };
  const applySun = (): void => {
    const moment = sunMoment();
    const sun = sunPosition(moment, KIGALI.latitude, KIGALI.longitude);
    const lighting = lightingFor(sun);
    land.setLighting(lighting, sunDirection(sun));
    view.setSun({
      time: clockTime(moment, KIGALI.timeZone),
      live: sunMode === "live",
      night: lighting.moonlit,
    });
    requestRender();
  };
  applySun();
  window.setInterval(() => {
    if (sunMode === "live" && fixedTime === null) applySun();
  }, SUN_REFRESH_MS);
  view.onToggleSun = () => {
    sunMode = sunMode === "live" ? "golden" : "live";
    applySun();
  };

  // --- Story position and camera ----------------------------------------------------
  const progressIn = (section: HTMLElement): number =>
    sectionProgress(window.scrollY, section.offsetTop, section.offsetHeight, window.innerHeight);
  // `?holdCamera` keeps the view from the end of Act 1 all through Act 2, so that two years
  // can be compared from exactly the same place.
  const holdCamera = params.has("holdCamera");
  const goalFor = (landProgress: number, cityProgress: number): CameraPose => {
    const inCity = cityProgress > 0 && !holdCamera;
    const keys: readonly CameraKey[] = inCity ? CITY_KEYS : LAND_KEYS;
    const progress = inCity ? cityProgress : landProgress;
    const along = reducedMotion ? nearestKeyTime(keys, progress) : progress;
    const aspect = window.innerWidth / window.innerHeight;
    const framed = shiftBesideText(
      tiltForPortrait(samplePath(keys, along), aspect, land.camera.fov),
      aspect,
      land.camera.fov,
    );
    return keepAboveGround(framed, (x, y) => land.groundAt(x, y), CAMERA_CLEARANCE);
  };
  let pose = goalFor(progressIn(view.landSection), progressIn(view.citySection));

  const showKigaliElevation = (): void => {
    view.setKigaliElevation(land.groundAt(KIGALI_CENTRE[0], KIGALI_CENTRE[1]));
  };
  showKigaliElevation();

  // --- Finer terrain, loaded in the background after the first frame --------------
  let loadingTerrain = false;
  const loadFinerLevels = async (): Promise<void> => {
    loadingTerrain = true;
    try {
      for (const name of ["region", "kigali"] as const) {
        // Compile the level's shader off to the side, then show it.
        await land.addLevel(name, await loader.load(name), async (mesh) => {
          const staging = new Scene();
          staging.add(mesh);
          await renderer.compileAsync(staging, land.camera);
          staging.remove(mesh);
        });
        state.levels = land.loadedLevels;
        showKigaliElevation();
        requestRender();
      }
    } catch (error) {
      // The coarser levels keep working; the story still runs.
      console.error(error);
    } finally {
      loadingTerrain = false;
      loader.dispose();
    }
  };

  // --- Buildings, loaded once the visitor is on the way to Kigali -------------------
  let buildings: BuildingLayer | null = null;
  let buildingsRequested = false;
  // Tiles arrive faster than it is worth redrawing; they are shown in batches.
  let tilesWaiting = false;
  let tilesShownAt = 0;
  // `?buildings=N` caps the buildings drawn per frame, for tests and for comparing devices.
  const buildingCap = Number(params.get("buildings"));
  const buildingBudget = (): (typeof BUILDING_BUDGETS)[Tier] => {
    const base = BUILDING_BUDGETS[state.quality.tier];
    return buildingCap > 0 ? { ...base, budget: Math.min(base.budget, buildingCap) } : base;
  };
  let loadingBuildings = false;
  const loadBuildings = async (): Promise<void> => {
    buildingsRequested = true;
    loadingBuildings = true;
    try {
      const buildingStats = await assets.json<BuildingStats>("buildings.stats");
      view.yearControl.setStats(buildingStats);
      view.yearControl.setYear(state.year);
      const layer = new BuildingLayer(land.scene, land.uniforms, buildingStats);
      buildings = layer;
      state.buildings.total = layer.totalBuildings;
      await layer.loadAll(
        assets,
        (x, y) => land.groundDetail(x, y),
        KIGALI_CENTRE,
        () => {
          state.buildings.loaded = layer.loaded;
          tilesWaiting = true;
        },
      );
    } catch (error) {
      // The land and the story still work without the buildings.
      console.error(error);
    } finally {
      loadingBuildings = false;
      tilesWaiting = false;
      requestRender();
    }
  };

  const applyQuality = (next: QualityState): void => {
    const tierChanged = next.tier !== state.quality.tier;
    state.quality = next;
    if (tierChanged) land.setQuality(TIERS[next.tier]);
    applySize();
  };

  // --- The year control ---------------------------------------------------------------
  let playing: { startedAt: number; fromYear: number } | null = null;
  const stopPlaying = (): void => {
    if (playing === null) return;
    playing = null;
    view.yearControl.setPlaying(false);
  };
  view.yearControl.onSeek = (year) => {
    stopPlaying();
    state.scrollToYear(year);
  };
  view.yearControl.onTogglePlay = () => {
    if (playing !== null) {
      stopPlaying();
      return;
    }
    // From the end, play again from the beginning.
    const fromYear = state.year >= LAST_YEAR - 0.01 ? FIRST_YEAR : state.year;
    playing = { startedAt: performance.now(), fromYear };
    view.yearControl.setPlaying(true);
  };
  // Any scroll the visitor makes takes control back.
  for (const event of ["wheel", "touchstart", "keydown"] as const) {
    window.addEventListener(event, stopPlaying, { passive: true });
  }

  // --- Frame loop -----------------------------------------------------------------
  const viewProjection = new Matrix4();
  let last = performance.now();
  let lastRendered = false;
  let perfUpdated = 0;
  let shownYear = Number.NaN;

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.25);
    const elapsed = now - last;
    last = now;

    if (playing !== null) {
      const year = playing.fromYear + (now - playing.startedAt) / 1000 / SECONDS_PER_YEAR;
      state.scrollToYear(Math.min(year, LAST_YEAR));
      if (year >= LAST_YEAR) stopPlaying();
    }

    const landProgress = progressIn(view.landSection);
    const cityProgress = progressIn(view.citySection);
    if (landProgress !== state.progress || cityProgress !== state.cityProgress) {
      state.progress = landProgress;
      state.cityProgress = cityProgress;
      view.setProgress(landProgress, cityProgress);
    }

    // With reduced motion the years step; otherwise buildings rise smoothly.
    const exactYear = yearForProgress(cityProgress);
    const year = reducedMotion ? Math.round(exactYear) : exactYear;
    if (year !== shownYear) {
      shownYear = year;
      state.year = year;
      view.yearControl.setYear(year);
      requestRender();
    }
    const layer = buildings as BuildingLayer | null;
    layer?.setYear(year - FIRST_YEAR);

    if (
      !buildingsRequested &&
      land.has("kigali") &&
      (landProgress > BUILDINGS_FROM_PROGRESS || cityProgress > 0)
    ) {
      void loadBuildings();
    }

    const goal = goalFor(landProgress, cityProgress);
    const altitude = Math.max(pose.position[2] - goal.target[2], 100);
    const before = pose;
    pose = reducedMotion ? goal : dampPose(pose, goal, dt, CAMERA_HALF_LIFE);
    // Close enough that the difference is far below a pixel: stop there.
    const arrived = poseDistance(pose, goal) < altitude * 2e-5;
    if (arrived) pose = goal;
    const moved = poseDistance(pose, before) > 0;

    if (tilesWaiting && now - tilesShownAt > TILE_REDRAW_MS) {
      tilesWaiting = false;
      tilesShownAt = now;
      requestRender();
    }

    if (moved || dirty || perf !== null) {
      land.setCamera(pose, window.innerWidth / window.innerHeight);
      layer?.update(land.camera, buildingBudget(), land.altitude01 < BUILDINGS_BELOW_ALTITUDE);
      renderer.render(land.scene, land.camera);
      state.renderedFrames++;
      if (layer !== null) {
        state.buildings.drawn = layer.drawn;
        view.yearControl.setStatus(layer.loaded, layer.totalBuildings, layer.drawn);
      }
      labels?.update({
        viewProjection: viewProjection.multiplyMatrices(
          land.camera.projectionMatrix,
          land.camera.matrixWorldInverse,
        ).elements,
        width: window.innerWidth,
        height: window.innerHeight,
        altitude01: land.altitude01,
        // Labels sit on the drawn ground, which curves away from the camera.
        groundAt: (x, y) => {
          const dx = x - pose.position[0];
          const dy = y - pose.position[1];
          return land.groundAt(x, y) - (dx * dx + dy * dy) / (2 * EARTH_RADIUS);
        },
      });
      // Frame times only count while frames follow one another without a pause.
      if (lastRendered) {
        stats.record(elapsed);
        const change = scaler?.sample(elapsed) ?? null;
        if (change !== null) applyQuality(change);
      }
      lastRendered = true;
      dirty = false;

      if (!state.ready) {
        state.ready = true;
        state.firstFrame = measureFirstFrame();
        state.levels = land.loadedLevels;
        view.reveal();
        void loadFinerLevels();
      }
    } else {
      lastRendered = false;
    }
    state.settled =
      state.ready && arrived && !loadingTerrain && !loadingBuildings && !dirty && playing === null;

    if (perf !== null && now - perfUpdated > 500) {
      perfUpdated = now;
      const report: PerfReport = {
        backend: context.backend,
        gpu: context.gpu,
        softwareRenderer: context.softwareRenderer,
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth} x ${window.innerHeight}`,
        drawingBuffer: `${view.canvas.width} x ${view.canvas.height}`,
        devicePixelRatio: window.devicePixelRatio,
        quality: state.quality,
        frames: stats.summary(),
        totalFrames: stats.totalFrames,
        totalHitches: stats.totalHitches,
        loadedLevels: land.loadedLevels,
        firstFrame: state.firstFrame,
        buildingsDrawn: state.buildings.drawn,
      };
      perf.update(report);
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}
