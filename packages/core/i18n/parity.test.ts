import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, STABLE_LOCALES, SUPPORTED_LOCALES, type SupportedLocale } from "./types";

/**
 * The gate between the locale files and PRODUCT.md's promise: Vietnamese and
 * English at full parity, anything else labelled beta. A key missing from a
 * stable locale does not break the app — it quietly falls back to Vietnamese
 * in the middle of an English screen, and nobody notices until a user does.
 *
 * Each rule is a pure function, proven against a fixture first (a guard is
 * only trusted once it has been seen to fail), then run over every file in
 * `locales/`, so a new locale is checked the moment its file exists.
 */

type Tree = { readonly [key: string]: unknown };

const SOURCE = "vi";
const LOCALES_DIR = resolve(process.cwd(), "i18n/locales");
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];
/** Letters only Vietnamese uses among Latin scripts — so not é, à or ô. */
const VIETNAMESE_ONLY = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệĩỉịọỏốồổỗộớờởỡợũụủứừửữựỳỵỷỹ]/iu;

/** Dotted key → text. A leaf that is not a string, or is blank, is a problem. */
function flatten(tree: Tree): { entries: Map<string, string>; problems: string[] } {
  const entries = new Map<string, string>();
  const problems: string[] = [];
  const walk = (node: Tree, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") {
        entries.set(path, value);
        if (value.trim() === "") problems.push(`${path}: blank`);
      } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        walk(value as Tree, path);
      } else {
        problems.push(`${path}: ${JSON.stringify(value)} is not a string`);
      }
    }
  };
  walk(tree, "");
  return { entries, problems };
}

/**
 * i18next picks `_one` or `_other` by count. A stem missing either renders
 * the fallback language for those counts, and a stem that is also a bare key
 * leaves a call without `count` reading a different string than one with it.
 */
function pluralProblems(keys: Iterable<string>): string[] {
  const all = new Set(keys);
  const stems = new Map<string, Set<string>>();
  for (const key of all) {
    const suffix = PLURAL_SUFFIXES.find((candidate) => key.endsWith(candidate));
    if (!suffix) continue;
    const stem = key.slice(0, -suffix.length);
    stems.set(stem, (stems.get(stem) ?? new Set<string>()).add(suffix));
  }
  const problems: string[] = [];
  for (const [stem, suffixes] of stems) {
    if (!suffixes.has("_one") || !suffixes.has("_other")) {
      problems.push(`${stem}: has ${[...suffixes].sort().join(" ")}, needs _one and _other`);
    }
    if (all.has(stem)) problems.push(`${stem}: exists both bare and with plural suffixes`);
  }
  return problems.sort();
}

function keyDiff(source: Iterable<string>, locale: Iterable<string>) {
  const sourceKeys = new Set(source);
  const localeKeys = new Set(locale);
  return {
    missing: [...sourceKeys].filter((key) => !localeKeys.has(key)).sort(),
    orphaned: [...localeKeys].filter((key) => !sourceKeys.has(key)).sort(),
  };
}

function variables(text: string): string {
  return [...text.matchAll(/\{\{\s*([^\s,}]+)[^}]*\}\}/g)]
    .map((match) => match[1])
    .sort()
    .join(" ");
}

/** A key both files carry interpolates the same variables in both. */
function variableProblems(source: ReadonlyMap<string, string>, locale: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [key, text] of locale) {
    const reference = source.get(key);
    if (reference === undefined || variables(reference) === variables(text)) continue;
    problems.push(`${key}: ${SOURCE} has (${variables(reference)}), this locale has (${variables(text)})`);
  }
  return problems.sort();
}

/** Text pasted from vi.json rather than translated. */
function vietnameseTextProblems(locale: ReadonlyMap<string, string>): string[] {
  return [...locale]
    .filter(([, text]) => VIETNAMESE_ONLY.test(text))
    .map(([key, text]) => `${key}: ${text}`)
    .sort();
}

describe("the locale gate", () => {
  it("reports leaves that are blank or not text", () => {
    expect(flatten({ a: { b: "ok", c: "  " }, d: 1, e: ["x"], f: null }).problems).toEqual([
      "a.c: blank",
      "d: 1 is not a string",
      'e: ["x"] is not a string',
      "f: null is not a string",
    ]);
  });

  it("reports plural stems missing a form or shadowed by a bare key", () => {
    expect(pluralProblems(["x_one", "x_other", "y_other", "z", "z_many"])).toEqual([
      "y: has _other, needs _one and _other",
      "z: exists both bare and with plural suffixes",
      "z: has _many, needs _one and _other",
    ]);
  });

  it("tells keys a locale lacks from keys only it has", () => {
    expect(keyDiff(["a", "b"], ["b", "c"])).toEqual({ missing: ["a"], orphaned: ["c"] });
  });

  it("compares variables by name, whatever their order or spacing", () => {
    const source = new Map([
      ["k", "{{count}} việc của {{name}}"],
      ["changed", "{{a}}"],
    ]);
    const locale = new Map([
      ["k", "{{ name }}'s {{count}} tasks"],
      ["changed", "{{b}}"],
      ["only_here", "{{c}}"],
    ]);
    expect(variableProblems(source, locale)).toEqual(["changed: vi has (a), this locale has (b)"]);
  });

  it("spots Vietnamese text without flagging European accents", () => {
    const locale = new Map([
      ["pasted", "Không tạo được"],
      ["french", "Café résumé à la carte"],
      ["name", "Hà"],
    ]);
    expect(vietnameseTextProblems(locale)).toEqual(["pasted: Không tạo được"]);
  });
});

const FILES = readdirSync(LOCALES_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();

const PARSED = new Map(
  FILES.map((code) => [code, flatten(JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), "utf8")) as Tree)]),
);

describe("locale files", () => {
  it("are exactly the supported locales", () => {
    expect(FILES).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("fall back to a stable locale, and only supported locales are stable", () => {
    expect(STABLE_LOCALES).toContain(DEFAULT_LOCALE);
    expect(STABLE_LOCALES.filter((code) => !SUPPORTED_LOCALES.includes(code))).toEqual([]);
  });

  const source = PARSED.get(SOURCE)?.entries ?? new Map<string, string>();

  for (const [code, { entries, problems }] of PARSED) {
    describe(code, () => {
      it("has only non-blank text leaves", () => {
        expect(problems).toEqual([]);
      });

      it("pairs every plural key as _one and _other", () => {
        expect(pluralProblems(entries.keys())).toEqual([]);
      });

      if (code === SOURCE) return;

      if (STABLE_LOCALES.includes(code as SupportedLocale)) {
        it("is stable, so it carries exactly the Vietnamese keys", () => {
          expect(keyDiff(source.keys(), entries.keys())).toEqual({ missing: [], orphaned: [] });
        });
      } else {
        it("is beta, so it may lack keys but carries none Vietnamese lacks", () => {
          expect(keyDiff(source.keys(), entries.keys()).orphaned).toEqual([]);
        });
      }

      it("interpolates the same variables as Vietnamese", () => {
        expect(variableProblems(source, entries)).toEqual([]);
      });

      it("contains no Vietnamese text", () => {
        expect(vietnameseTextProblems(entries)).toEqual([]);
      });
    });
  }
});
