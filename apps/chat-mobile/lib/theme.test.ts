// THEME mirrors global.css: both modes name the same slots, every one an hsl()
// colour, so a token added to one mode cannot fall back to undefined in the other;
// and each slot holds the value global.css gives NativeWind, so an inline style
// and a class never draw two colours for one token (a contrast fix in one file only).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME } from "./theme";

const css = fs.readFileSync(path.resolve(__dirname, "../global.css"), "utf8");

/** The `--slot: h s% l%` declarations of one block, keyed as THEME names them (camelCase). */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n  }", start));
  const out: Record<string, string> = {};
  for (const [, name = "", value = ""] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = `hsl(${value.trim()})`;
  }
  return out;
}

describe("THEME", () => {
  it("declares every slot in both modes, as an hsl() colour", () => {
    expect(Object.keys(THEME.dark).sort()).toEqual(Object.keys(THEME.light).sort());
    for (const value of [...Object.values(THEME.light), ...Object.values(THEME.dark)]) expect(value).toMatch(/^hsla?\(/);
  });

  it.each([
    ["light", ":root"],
    ["dark", ".dark:root"],
  ] as const)("holds global.css's value for every %s slot", (mode, selector) => {
    const declared = block(selector);
    const drift = Object.entries(THEME[mode]).flatMap(([slot, value]) => (declared[slot] === value ? [] : [`${slot}: theme ${value}, css ${declared[slot]}`]));
    expect(drift).toEqual([]);
  });
});
