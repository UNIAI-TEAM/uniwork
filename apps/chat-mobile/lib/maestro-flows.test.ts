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
import { actionMenuLayout } from "./action-menu-layout";

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

  // A full-screen backdrop (the long-press menu's, BottomSheet's) is named common.close, and Maestro taps the centre of
  // what it finds. That centre is under the menu or the sheet drawn above the backdrop, so a tap by that name presses
  // whichever row sits there (Pin, Forward, Delete…) against the shared staging room, and the menu still closes.
  it("never taps an overlay closed by the backdrop's name", () => {
    const close = [closeLabel("vi"), closeLabel("en")];
    // `- tapOn: "Close|Đóng"`, or `text: …` right under a `- tapOn:` block.
    const tapped = lines.flatMap(({ where, line }, i) => {
      const inline = /^\s*-\s*tapOn:\s*"?([^"]+?)"?\s*$/.exec(line)?.[1];
      const underTap = /^\s*-\s*tapOn:\s*$/.test(lines[i - 1]?.line ?? "");
      const nested = underTap ? /^\s*text:\s*"?([^"]+?)"?\s*$/.exec(line)?.[1] : undefined;
      const pattern = inline ?? nested;
      return pattern ? [{ where, pattern }] : [];
    });
    const hits = tapped.filter(({ pattern }) => close.some((label) => new RegExp(`^(?:${pattern})$`).test(label)));
    expect(hits.map(({ where, pattern }) => `${where} "${pattern}"`)).toEqual([]);
  });

  // The menu flow closes the menu at a point, so the point must be one the column never covers at any width the nightly
  // runs: the column's side padding, which is what is left beside a width-capped card on the narrowest window.
  it("closes the long-press menu at a point in the gutter beside the column", () => {
    const flow = lines.filter(({ where }) => where.startsWith(path.join("maestro", "flows", "message-menu-large-text.yaml")));
    const points = flow.flatMap(({ where, line }) => {
      const match = /^\s*point:\s*"?(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%"?\s*$/.exec(line);
      return match ? [{ where, x: Number(match[1]), y: Number(match[2]) }] : [];
    });
    expect(points.length).toBeGreaterThan(0);
    const narrow = 360;
    const { menuWidth } = actionMenuLayout({
      windowWidth: narrow,
      windowHeight: 640,
      fontScale: 2,
      insetTop: 24,
      insetBottom: 48,
      reactions: true,
      senderName: false,
      avatar: false,
    });
    const gutter = (narrow - menuWidth) / 2;
    expect(gutter).toBeGreaterThan(8);
    // The widest iPhone the simulator step may pick (`... | last`) is 440 pt; the point must stay off the very edge too.
    const outside = points.filter(({ x, y }) => !((x / 100) * 440 < gutter && x >= 1 && y >= 25 && y <= 75));
    expect(outside.map(({ where, x, y }) => `${where} ${x}%,${y}%`)).toEqual([]);
  });
});

/** common.close in one language: the name every full-screen backdrop carries. */
function closeLabel(lang: "vi" | "en"): string {
  const file: unknown = JSON.parse(fs.readFileSync(path.join(appRoot, `locales/${lang}.json`), "utf8"));
  const common: unknown = file !== null && typeof file === "object" && "common" in file ? file.common : null;
  const close: unknown = common !== null && typeof common === "object" && "close" in common ? common.close : null;
  if (typeof close !== "string") throw new Error(`locales/${lang}.json has no common.close`);
  return close;
}
