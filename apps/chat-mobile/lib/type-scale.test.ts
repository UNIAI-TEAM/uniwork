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

/**
 * Boxes that keep a fixed height on purpose, by file and class string: none holds text that grows with the
 * system text size. Anything else that holds text takes `min-h-*` and vertical padding (S6 dynamic type).
 */
const FIXED_HEIGHT_OK: Record<string, string[]> = {
  // The decorative illustration (hidden from screen readers) is a fixed stage; its text bubbles are placed on it.
  // The wall's fade at its foot is an image.
  "app/(auth)/login.tsx": ["relative h-[440px]", "absolute inset-x-0 bottom-0 h-[220px] w-full"],
  // Scrims over the video: shading, no text.
  "components/calls/call-room.tsx": ["absolute inset-x-0 top-0 h-36", "absolute inset-x-0 bottom-0 h-48"],
  // A sheet's share of the screen, not a text box.
  "components/chat/expression-sheet.tsx": ["h-[70%]"],
  "components/chat/forward-sheet.tsx": ["h-[80%]"],
  // The voice note's waveform: bars, no text.
  "components/chat/voice-card.tsx": ["h-[26px] flex-row items-center gap-0.5"],
  "components/chat/voice-wave.tsx": ["h-6 flex-1 flex-row items-center gap-[2px] overflow-hidden"],
  // The loading skeleton: grey shapes standing in for text, which never hold any.
  "components/chat/room-list-parts.tsx": ["h-[34px] rounded-full bg-muted", "h-[76px] flex-row items-center gap-3 px-4", "h-3.5 rounded-full bg-muted", "h-3 max-w-full rounded-full bg-muted"],
  // Three animated dots, no text.
  "components/chat/typing-bubble.tsx": ["h-9 flex-row items-center gap-1 bg-chat-bubble-other px-3.5"],
};

/** Not a fixed box: a rule, divider or progress bar at most 2 (8 px) high, or a height that follows content or parent. */
const NOT_FIXED = /^h-(px|0\.5|1|1\.5|2|\[[1-8]px\]|auto|full)$/;

describe("text containers", () => {
  it("grow with the system text size: no fixed h-* outside icon/avatar boxes, thin rules and the list above", () => {
    const offenders = ["app", "components"].flatMap(sources).flatMap((file) =>
      fs
        .readFileSync(path.join(appRoot, file), "utf8")
        .split("\n")
        .flatMap((line, i) =>
          [...line.matchAll(/"([^"]*)"|`([^`]*)`/g)].flatMap((match) => {
            const literal = match[1] ?? match[2] ?? "";
            const tokens = literal.split(/\s+/);
            const height = tokens.find((token) => /^h-\S+$/.test(token));
            if (!height || NOT_FIXED.test(height)) return [];
            // An icon, avatar or tile box: a fixed width beside the height (w-full or a fraction is a row, not a box).
            if (tokens.some((token) => /^(w|size)-(\d+(\.\d+)?|\[\d+px\]|px)$/.test(token))) return [];
            if (FIXED_HEIGHT_OK[file]?.includes(literal)) return [];
            return [`${file}:${i + 1} "${literal}"`];
          }),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("allows nothing it does not need: every allowed fixed height is still in its file", () => {
    const stale = Object.entries(FIXED_HEIGHT_OK).flatMap(([file, literals]) => {
      const text = fs.readFileSync(path.join(appRoot, file), "utf8");
      return literals.filter((literal) => !text.includes(literal)).map((literal) => `${file} "${literal}"`);
    });
    expect(stale).toEqual([]);
  });
});
