import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Fills `%t:some.key%` tokens in index.html from the English catalog, so the
 * static HTML (title, description, noscript) shares one source of text with
 * the app and is covered by the same text checks.
 */
function htmlMessages(): Plugin {
  return {
    name: "hilltide-html-messages",
    transformIndexHtml(html) {
      const catalog = JSON.parse(readFileSync(here("./src/i18n/en.json"), "utf8")) as Record<
        string,
        string
      >;
      return html.replace(/%t:([\w.]+)%/g, (_match, key: string) => {
        const value = catalog[key];
        if (value === undefined) {
          throw new Error(`index.html uses unknown message key "${key}"`);
        }
        return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      });
    },
  };
}

export default defineConfig({
  // Relative base: the build works at any path, including /hilltide/ on GitHub Pages.
  base: "./",
  plugins: [htmlMessages()],
  build: {
    target: "es2022",
    sourcemap: false,
  },
  server: {
    // site.config.json lives at the repository root.
    fs: { allow: [".."] },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
