import { describe, expect, it } from "vitest";
import { parseSiteConfig, siteConfig } from "./siteConfig";

describe("parseSiteConfig", () => {
  it("treats the placeholder name and blank links as unset", () => {
    const config = parseSiteConfig({
      creatorName: "Your Name",
      creatorLinks: { github: "", linkedin: "", x: "" },
      siteUrl: "",
      languages: ["en"],
    });
    expect(config).toEqual({
      creatorName: null,
      creatorLinks: [],
      siteUrl: null,
      languages: ["en"],
    });
  });

  it("keeps a real name and valid web links, in a fixed order", () => {
    const config = parseSiteConfig({
      creatorName: "  Ada Lovelace ",
      creatorLinks: { x: "https://x.com/ada", github: "https://github.com/ada" },
      siteUrl: "https://example.org/hilltide/",
      languages: ["en", "rw"],
    });
    expect(config.creatorName).toBe("Ada Lovelace");
    expect(config.creatorLinks).toEqual([
      { kind: "github", url: "https://github.com/ada" },
      { kind: "x", url: "https://x.com/ada" },
    ]);
    expect(config.siteUrl).toBe("https://example.org/hilltide/");
    expect(config.languages).toEqual(["en", "rw"]);
  });

  it("drops links that are not web addresses", () => {
    const config = parseSiteConfig({
      creatorLinks: { github: "javascript:alert(1)", linkedin: "not a url" },
    });
    expect(config.creatorLinks).toEqual([]);
  });

  it("survives malformed input", () => {
    for (const raw of [null, undefined, 42, "text", [], { languages: "en" }]) {
      const config = parseSiteConfig(raw);
      expect(config.languages).toEqual(["en"]);
      expect(config.creatorName).toBeNull();
    }
  });

  it("loads the repository's site.config.json", () => {
    expect(siteConfig.languages).toContain("en");
  });
});
