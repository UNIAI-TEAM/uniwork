// The text roles (type-scale.ts): the scale itself, that tailwind and cn()
// both read it, and that no screen falls back to Tailwind's default ramp or a
// raw pixel size, which would escape the scale.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BADGE_MAX_FONT_SCALE } from "./type-scale";
import typeScale from "./type-scale.json";
import { cn } from "./utils";

const appRoot = path.resolve(__dirname, "..");

function sources(dir: string): string[] {
  return fs.readdirSync(path.join(appRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

describe("text roles", () => {
  it("run from the meta line to the display title, each a size in points", () => {
    const sizes = Object.values(typeScale).map(([size]) => size);
    expect(typeScale.meta[0]).toBe(11);
    expect(typeScale.body).toEqual([16, 24]);
    expect(sizes.every((size) => size !== undefined && Number.isInteger(size) && size >= 11)).toBe(true);
    expect(BADGE_MAX_FONT_SCALE).toBeGreaterThan(1);
  });

  it("are font sizes to cn(), so a role and a colour on one element both stay", () => {
    expect(cn("text-footnote font-semibold", "text-muted-foreground")).toBe("text-footnote font-semibold text-muted-foreground");
    expect(cn("text-footnote", "text-body")).toBe("text-body");
  });

  it("are what tailwind.config.js gives NativeWind", () => {
    const config = fs.readFileSync(path.join(appRoot, "tailwind.config.js"), "utf8");
    expect(config).toContain('require("./lib/type-scale.json")');
  });

  it("are the only text sizes app/ and components/ use", () => {
    const ramp = /(^|[\s"'`])(text-(xs|sm|base|lg|xl|[2-9]xl)|text-\[\d+(px)?\])(?=[\s"'`]|$)/;
    const offenders = ["app", "components"].flatMap(sources).flatMap((file) =>
      fs
        .readFileSync(path.join(appRoot, file), "utf8")
        .split("\n")
        .flatMap((line, i) => (ramp.test(line) ? [`${file}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
