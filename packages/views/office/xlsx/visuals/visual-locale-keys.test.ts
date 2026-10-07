import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// review-visuals V5: the per-item copy of the visual overlay is looked up by
// literal key, so a key no source names any more is dead copy in both packs.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "..", "..", "..", "..", "core", "i18n", "locales");
const PREFIX = "office.xlsx.visuals.item";

const sources = readdirSync(HERE)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => readFileSync(join(HERE, name), "utf8"))
  .join("\n");

describe("visual item copy", () => {
  it.each(["en", "vi"])("every %s key under office.xlsx.visuals.item is used by the overlay", (locale) => {
    const pack = JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), "utf8")) as { office: { xlsx: { visuals: { item: Record<string, string> } } } };
    const unused = Object.keys(pack.office.xlsx.visuals.item).filter((key) => !sources.includes(`${PREFIX}.${key}`));
    expect(unused).toEqual([]);
  });
});
