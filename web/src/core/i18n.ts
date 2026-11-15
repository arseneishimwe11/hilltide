import en from "../i18n/en.json";

/** Every message key. English is the source catalog; other locales are partial. */
export type MessageKey = keyof typeof en;
export type Catalog = Readonly<Record<MessageKey, string>>;
export type PartialCatalog = Readonly<Partial<Record<MessageKey, string>>>;
export type MessageParams = Readonly<Record<string, string | number>>;

export const SOURCE_LOCALE = "en";

/**
 * Locales that ship. Kinyarwanda ("rw") is added here only after a native
 * speaker has reviewed the strings (see site.config.json).
 */
const catalogs: Record<string, PartialCatalog> = { [SOURCE_LOCALE]: en };

let activeLocale: string = SOURCE_LOCALE;

export function availableLocales(): readonly string[] {
  return Object.keys(catalogs);
}

export function getLocale(): string {
  return activeLocale;
}

export function setLocale(locale: string): void {
  if (!(locale in catalogs)) {
    throw new Error(`Locale "${locale}" is not available`);
  }
  activeLocale = locale;
}

/** Replaces `{name}` placeholders. Unknown placeholders are left visible so they get noticed. */
export function formatMessage(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Looks up a message in the active locale, falling back to English. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = catalogs[activeLocale]?.[key] ?? (en as Catalog)[key];
  return formatMessage(template, params);
}

/** All strings of the source catalog, for text checks. */
export function sourceMessages(): ReadonlyArray<readonly [MessageKey, string]> {
  return Object.entries(en) as Array<[MessageKey, string]>;
}
