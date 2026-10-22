// The Maestro flows (maestro/) find what they tap and wait for by the text a
// person reads or by a testID. A text the app does not have times the step out
// on a device, every night, and nothing local would say so: the nightly flow
// once waited for "Waiting for network…" while the English banner reads
// "Waiting for a connection…". This test holds every quoted text of every flow
// to the strings the app (locales/) or the web pages the sign-in opens
// (packages/core/i18n/locales/) actually draw, in Vietnamese and in English,
// and every literal `id:` to a testID the code sets.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");

/** Texts that are not UI copy, with the reason. */
const NOT_COPY: Record<string, string> = {
  "UniChat Maestro": "the seeded room's name (MAESTRO_* fixtures), not a string of the app",
  "UniChat never draws this text": "a sentinel the flow waits on to time out on purpose",
  ".*Perf jump target.*": "the body of the message perf-jump-quote.yaml's seeded quote names (runbook), not a string of the app",
};

function filesUnder(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(full, ext);
    return ext.test(entry.name) ? [full] : [];
  });
}

function stringValues(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node !== null && typeof node === "object") return Object.values(node).flatMap(stringValues);
  return [];
}

/** Every string a locale file holds, its interpolations drawn as a word. */
function localeStrings(file: string): string[] {
  return stringValues(JSON.parse(fs.readFileSync(file, "utf8"))).map((value) => value.replace(/\{\{[^}]+\}\}/g, "X"));
}

const flows = filesUnder(path.join(appRoot, "maestro"), /\.ya?ml$/);
const lines = flows.flatMap((file) => fs.readFileSync(file, "utf8").split("\n").map((line, i) => ({ where: `${path.relative(appRoot, file)}:${i + 1}`, line })));

/** The quoted texts the flows look for: `visible: "…"`, `tapOn: "…"`, `text: "…"` and the like. */
const texts = lines.flatMap(({ where, line }) => {
  const match = /^\s*-?\s*(?:visible|notVisible|tapOn|assertVisible|assertNotVisible|text):\s*"([^"]+)"\s*$/.exec(line);
  return match?.[1] ? [{ where, pattern: match[1] }] : [];
});

/** The literal ids: `id: composer-input`, or the fixed head of `id: room-row-${…}`. */
const ids = lines.flatMap(({ where, line }) => {
  const match = /^\s*-?\s*id:\s*"?([A-Za-z0-9_-]+)/.exec(line);
  return match?.[1] ? [{ where, id: match[1] }] : [];
});

describe("Maestro flows", () => {
  const vi = [...localeStrings(path.join(appRoot, "locales/vi.json")), ...localeStrings(path.join(repoRoot, "packages/core/i18n/locales/vi.json"))];
  const en = [...localeStrings(path.join(appRoot, "locales/en.json")), ...localeStrings(path.join(repoRoot, "packages/core/i18n/locales/en.json"))];

  it("finds texts and ids to check", () => {
    expect(texts.length).toBeGreaterThan(5);
    expect(ids.length).toBeGreaterThan(5);
  });

  it("looks only for texts the app draws, in both languages", () => {
    const missing = texts.flatMap(({ where, pattern }) => {
      if (pattern in NOT_COPY) return [];
      // Maestro matches the whole text against the pattern, as a regular expression.
      const regex = new RegExp(`^(?:${pattern})$`);
      const langs = [vi.some((value) => regex.test(value)) ? null : "vi", en.some((value) => regex.test(value)) ? null : "en"].filter(Boolean);
      return langs.length > 0 ? [`${where} "${pattern}" matches no ${langs.join("/")} string`] : [];
    });
    expect(missing).toEqual([]);
  });

  it("looks only for ids the code sets as a testID", () => {
    const source = [...filesUnder(path.join(appRoot, "app"), /\.tsx$/), ...filesUnder(path.join(appRoot, "components"), /\.tsx$/)]
      .filter((file) => !file.endsWith(".test.tsx"))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    // A whole id as a string literal, or the fixed head of a template (`room-row-${row.roomId}`).
    const missing = ids.filter(({ id }) => !source.includes(`"${id}"`) && !source.includes(`\`${id}`)).map(({ where, id }) => `${where} ${id}`);
    expect(missing).toEqual([]);
  });
});
