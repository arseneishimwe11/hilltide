import { t } from "./core/i18n";
import { initialTier, QualityScaler, type QualityState, TIERS, type Tier } from "./core/quality";
import { createRenderer, graphicsSupport, type RenderContext } from "./core/renderer";
import { siteConfig } from "./core/siteConfig";
import { AssetLoader } from "./data/manifest";
import { FrameStats, type FrameSummary } from "./perf/frameStats";
import { PerfOverlay, type PerfReport } from "./perf/overlay";
import { lightingFor } from "./sky/lighting";
import { clockTime, goldenHour, KIGALI, sunDirection, sunPosition } from "./sky/sun";
import {
  type CameraPose,
  dampPose,
  keepAboveGround,
  nearestKeyTime,
  poseDistance,
  samplePath,
  tiltForPortrait,
} from "./story/cameraPath";
import { KIGALI_CENTRE, LAND_CHAPTERS, LAND_KEYS } from "./story/landStory";
import { scrollForProgress, sectionProgress } from "./story/scroll";
import { LandScene } from "./terrain/landScene";
import { type LevelName, TerrainLoader } from "./terrain/terrainLoader";
import { StoryView } from "./ui/storyView";

/** What the page exposes for tests and for measuring on real devices. */
export interface HilltideState {
  ready: boolean;
  failed: string | null;
  backend: string;
  gpu: string;
  softwareRenderer: boolean;
  progress: number;
  /** True when the camera has arrived and nothing is still loading. */
  settled: boolean;
  levels: LevelName[];
  quality: QualityState;
  renderedFrames: number;
  /** Time and downloaded bytes up to the first live frame; null until then. */
  firstFrame: { ms: number; bytes: number; requests: number } | null;
  frames(): FrameSummary;
  scrollToProgress(progress: number): void;
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
  const view = new StoryView(root, LAND_CHAPTERS, siteConfig);

  const state: HilltideState = {
    ready: false,
    failed: null,
    backend: "",
    gpu: "",
    softwareRenderer: false,
    progress: 0,
    settled: false,
    levels: [],
    quality: { tier: "medium", resolutionScale: 1 },
    renderedFrames: 0,
    firstFrame: null,
    frames: () => stats.summary(),
    scrollToProgress: (progress) => {
      const section = view.landSection;
      window.scrollTo(
        0,
        scrollForProgress(progress, section.offsetTop, section.offsetHeight, window.innerHeight),
      );
    },
  };
  const stats = new FrameStats();
  window.__hilltide = state;

  const support = graphicsSupport();
  if (!support.webgpu && !support.webgl2) {
    state.failed = "unsupported";
    view.fail(t("unsupported.body"), t("unsupported.title"));
    return;
  }

  let context: RenderContext;
  let land: LandScene;
  let loader: TerrainLoader;
  try {
    const assets = await AssetLoader.open(`${import.meta.env.BASE_URL}data/`);
    loader = new TerrainLoader(assets);
    const forceWebGL = params.get("backend") === "webgl2";
    const [created, country] = await Promise.all([
      createRenderer(view.canvas, { forceWebGL }),
      loader.load("country"),
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
    land = new LandScene(TIERS[tier]);
    land.addLevel("country", country);
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

  let dirty = true;
  let loading = false;

  // --- Size and resolution ----------------------------------------------------
  const applySize = (): void => {
    const settings = TIERS[state.quality.tier];
    const ratio =
      Math.min(window.devicePixelRatio || 1, settings.pixelRatioCap) *
      state.quality.resolutionScale;
    renderer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    dirty = true;
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
    dirty = true;
  };
  applySun();
  window.setInterval(() => {
    if (sunMode === "live" && fixedTime === null) applySun();
  }, SUN_REFRESH_MS);
  view.onToggleSun = () => {
    sunMode = sunMode === "live" ? "golden" : "live";
    applySun();
  };

  // --- Camera ---------------------------------------------------------------------
  const readProgress = (): number => {
    const section = view.landSection;
    return sectionProgress(
      window.scrollY,
      section.offsetTop,
      section.offsetHeight,
      window.innerHeight,
    );
  };
  const goalFor = (progress: number): CameraPose => {
    const along = reducedMotion ? nearestKeyTime(LAND_KEYS, progress) : progress;
    const framed = tiltForPortrait(
      samplePath(LAND_KEYS, along),
      window.innerWidth / window.innerHeight,
      land.camera.fov,
    );
    return keepAboveGround(framed, (x, y) => land.groundAt(x, y), CAMERA_CLEARANCE);
  };
  let pose = goalFor(readProgress());

  const showKigaliElevation = (): void => {
    view.setKigaliElevation(land.groundAt(KIGALI_CENTRE[0], KIGALI_CENTRE[1]));
  };
  showKigaliElevation();

  // --- Finer terrain, loaded in the background after the first frame --------------
  const loadFinerLevels = async (): Promise<void> => {
    loading = true;
    try {
      for (const name of ["region", "kigali"] as const) {
        land.addLevel(name, await loader.load(name));
        state.levels = land.loadedLevels;
        showKigaliElevation();
        dirty = true;
      }
    } catch (error) {
      // The coarser levels keep working; the story still runs.
      console.error(error);
    } finally {
      loading = false;
      loader.dispose();
    }
  };

  const applyQuality = (next: QualityState): void => {
    const tierChanged = next.tier !== state.quality.tier;
    state.quality = next;
    if (tierChanged) land.setQuality(TIERS[next.tier]);
    applySize();
  };

  // --- Frame loop -----------------------------------------------------------------
  let last = performance.now();
  let lastRendered = false;
  let perfUpdated = 0;

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.25);
    const elapsed = now - last;
    last = now;

    const progress = readProgress();
    if (progress !== state.progress) {
      state.progress = progress;
      view.setProgress(progress);
    }
    const goal = goalFor(progress);
    const altitude = Math.max(pose.position[2] - goal.target[2], 100);
    const before = pose;
    pose = reducedMotion ? goal : dampPose(pose, goal, dt, CAMERA_HALF_LIFE);
    // Close enough that the difference is far below a pixel: stop there.
    const arrived = poseDistance(pose, goal) < altitude * 2e-5;
    if (arrived) pose = goal;
    const moved = poseDistance(pose, before) > 0;

    if (moved || dirty || perf !== null) {
      land.setCamera(pose, window.innerWidth / window.innerHeight);
      renderer.render(land.scene, land.camera);
      state.renderedFrames++;
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
    state.settled = state.ready && arrived && !loading && !dirty;

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
      };
      perf.update(report);
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}
