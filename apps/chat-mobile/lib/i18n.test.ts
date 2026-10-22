// Parity of the generated locale bundles: they are exactly what
// scripts/sync-i18n.mjs produces from packages/core (so a core copy change
// shows up here as a stale file), vi and en carry the same keys, and every
// English string that counts something has its singular and plural forms.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, i18n, matchSupportedLocale } from "./i18n/singleton";

const appRoot = path.resolve(__dirname, "..");

function flatten(value: unknown, prefix = ""): [string, string][] {
  if (typeof value !== "object" || value === null) return [[prefix, String(value)]];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

function readLocale(locale: string): Map<string, string> {
  return new Map(flatten(JSON.parse(fs.readFileSync(path.join(appRoot, "locales", `${locale}.json`), "utf8"))));
}

/** i18next JSON v4 plural suffixes; Vietnamese has one form, so its key is bare (as in packages/core). */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const stem = (key: string) => key.replace(PLURAL, "");

const EN = readLocale("en");
const VI = readLocale("vi");

describe("locales", () => {
  it("are what sync-i18n.mjs generates from packages/core", () => {
    expect(() => execFileSync(process.execPath, [path.join(appRoot, "scripts/sync-i18n.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("carry the same keys in vi and en, plural forms counted once", () => {
    const stems = (keys: Iterable<string>) => [...new Set([...keys].map(stem))].sort();
    expect(stems(EN.keys())).toEqual(stems(VI.keys()));
  });

  // A placeholder in one language only is a value the other never shows ("{{name}} blocked." vs "Đã chặn.").
  // Plural forms share their stem's placeholders; an English _one may drop {{count}} ("1 reply" → "One reply").
  it("interpolate the same {{placeholders}} in vi and en", () => {
    const placeholders = (text: string) => [...new Set([...text.matchAll(/\{\{\s*([\w.]+)/g)].map((m) => m[1]!))].sort();
    const byStem = (locale: Map<string, string>) => {
      const stems = new Map<string, Set<string>>();
      for (const [key, text] of locale) {
        const set = stems.get(stem(key)) ?? new Set<string>();
        for (const name of placeholders(text)) set.add(name);
        stems.set(stem(key), set);
      }
      return stems;
    };
    const en = byStem(EN);
    const vi = byStem(VI);
    const mismatched = [...en].flatMap(([key, names]) => {
      const other = [...(vi.get(key) ?? [])].sort().join();
      return [...names].sort().join() === other ? [] : [`${key}: en {${[...names].sort().join()}} vi {${other}}`];
    });
    expect(mismatched).toEqual([]);
  });

  it("give every English string that interpolates {{count}} a _one and an _other form", () => {
    const counted = [...EN].filter(([, text]) => text.includes("{{count}}")).map(([key]) => key);
    expect(counted.filter((key) => !PLURAL.test(key))).toEqual([]);
    const missing = [...new Set(counted.map(stem))].flatMap((base) => ["_one", "_other"].filter((suffix) => !EN.has(`${base}${suffix}`)).map((suffix) => `${base}${suffix}`));
    expect(missing).toEqual([]);
  });
});

describe("i18n singleton", () => {
  it("starts in Vietnamese and switches to English", async () => {
    expect(DEFAULT_LOCALE).toBe("vi");
    expect(SUPPORTED_LOCALES).toEqual(["vi", "en"]);
    expect(i18n.t("auth.desktop.unichat_login_title")).toBe("Chào mừng đến với UniChat");
    expect(i18n.t("mobile.tab_calls")).toBe("Cuộc gọi");
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.settings")).toBe("Settings");
    await i18n.changeLanguage("vi");
  });

  it("picks the English singular for one and the plural for more, and the one Vietnamese form for both", () => {
    const en = i18n.getFixedT("en");
    const vi = i18n.getFixedT("vi");
    expect(en("chat.thread_replies", { count: 1 })).toBe("1 reply");
    expect(en("chat.thread_replies", { count: 3 })).toBe("3 replies");
    expect(en("chat.composer_state.chars_over", { count: 1 })).toBe("1 character over");
    expect(en("chat.mobile.workspace_count_only", { count: 1 })).toBe("1 workspace you belong to");
    expect(vi("chat.thread_replies", { count: 1 })).toBe(vi("chat.thread_replies", { count: 3 }).replace("3", "1"));
  });

  it("matches the device language only between vi and en, and reads English on a phone that speaks neither", () => {
    expect(matchSupportedLocale(["fr-FR", "en-GB"])).toBe("en");
    expect(matchSupportedLocale(["ja-JP", "vi_VN"])).toBe("vi");
    expect(matchSupportedLocale(["vi_VN"])).toBe("vi");
    expect(matchSupportedLocale(["fr-FR", "de"])).toBe("en");
    expect(matchSupportedLocale([])).toBe("vi");
  });
});
