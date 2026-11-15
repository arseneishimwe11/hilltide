import { afterEach, describe, expect, it } from "vitest";
import {
  availableLocales,
  formatMessage,
  getLocale,
  SOURCE_LOCALE,
  setLocale,
  sourceMessages,
  t,
} from "./i18n";

afterEach(() => setLocale(SOURCE_LOCALE));

describe("i18n", () => {
  it("returns source strings by key", () => {
    expect(t("site.name")).toBe("Hilltide");
    expect(t("site.tagline")).toBe("Rwanda's thousand hills, alive.");
  });

  it("fills named placeholders", () => {
    expect(t("about.createdBy", { name: "Ada" })).toBe("Created by Ada");
    expect(formatMessage("{n} buildings since {year}", { n: 12, year: 2016 })).toBe(
      "12 buildings since 2016",
    );
  });

  it("leaves unknown placeholders visible", () => {
    expect(formatMessage("Hello {who}")).toBe("Hello {who}");
  });

  it("ships English only until Kinyarwanda is reviewed", () => {
    expect(availableLocales()).toEqual(["en"]);
    expect(() => setLocale("rw")).toThrow(/not available/);
    expect(getLocale()).toBe("en");
  });

  it("has no empty or untrimmed source strings", () => {
    for (const [key, message] of sourceMessages()) {
      expect(message.trim(), key).toBe(message);
      expect(message.length, key).toBeGreaterThan(0);
    }
  });
});
