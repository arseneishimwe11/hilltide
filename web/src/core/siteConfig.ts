import rawConfig from "../../../site.config.json";

export interface CreatorLink {
  readonly kind: "github" | "linkedin" | "x";
  readonly url: string;
}

export interface SiteConfig {
  /** Null until the owner replaces the placeholder in site.config.json. */
  readonly creatorName: string | null;
  readonly creatorLinks: readonly CreatorLink[];
  readonly siteUrl: string | null;
  readonly languages: readonly string[];
}

const PLACEHOLDER_NAME = "Your Name";
const LINK_KINDS = ["github", "linkedin", "x"] as const;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function httpUrl(value: unknown): string | null {
  const candidate = text(value);
  if (candidate === null) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Validates the owner-edited site.config.json. Anything missing, blank, still
 * a placeholder or not a web link is dropped, so the page never shows
 * "Your Name" or a broken link.
 */
export function parseSiteConfig(raw: unknown): SiteConfig {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const links = (
    typeof source.creatorLinks === "object" && source.creatorLinks !== null
      ? source.creatorLinks
      : {}
  ) as Record<string, unknown>;

  const name = text(source.creatorName);
  const languages = Array.isArray(source.languages)
    ? source.languages.filter((item): item is string => typeof item === "string" && item !== "")
    : [];

  return {
    creatorName: name === PLACEHOLDER_NAME ? null : name,
    creatorLinks: LINK_KINDS.flatMap((kind) => {
      const url = httpUrl(links[kind]);
      return url === null ? [] : [{ kind, url }];
    }),
    siteUrl: httpUrl(source.siteUrl),
    languages: languages.length > 0 ? languages : ["en"],
  };
}

export const siteConfig: SiteConfig = parseSiteConfig(rawConfig);
