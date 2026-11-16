import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

/**
 * Chromium flags that give headless test machines working graphics without
 * a GPU: WebGL2 through ANGLE on SwiftShader, and WebGPU through Vulkan on
 * SwiftShader. Everything is rendered in software, so it is slow but real.
 * (With `--use-webgpu-adapter=swiftshader` instead, the WebGPU device is
 * lost on the first frame.)
 */
export const SOFTWARE_GRAPHICS = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan",
  "--use-vulkan=swiftshader",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

/** Headless browser tests run against the production build (`npm run build` first). */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/artifacts",
  fullyParallel: false,
  workers: 2,
  // Software rendering of a 3D scene takes seconds per frame.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: "off",
    launchOptions: { args: SOFTWARE_GRAPHICS },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1120, height: 700 } },
    },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
