import { describe, expect, it } from "vitest";
import {
  PPTX_DESIGN_SLIDE_SIZES,
  PPTX_DESIGN_THEMES,
  buildBackgroundEdit,
  buildGraphicsHiddenEdit,
  buildLayoutEdit,
  buildSlideSizeEdit,
  buildThemeEdit,
  emuToInches,
  imageExtension,
  isFillColor,
  matchSlideSizePreset,
  nextRovingIndex,
  normalizeHex,
  parseAngleDeg,
  rovingEntryIndex,
  slideIndexRange,
  themeSwatch,
  type PptxDesignTheme,
} from "./design-model";

const SCHEME_SLOTS = [
  "dk1", "lt1", "dk2", "lt2",
  "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
  "hlink", "folHlink",
];

describe("built-in presets", () => {
  it("ships themes with every scheme slot as a valid hex color and unique ids", () => {
    const ids = PPTX_DESIGN_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const theme of PPTX_DESIGN_THEMES) {
      expect(theme.nameKey).toBe(`office.pptx.design.theme.${theme.id}`);
      for (const slot of SCHEME_SLOTS) {
        const value = theme.colors[slot];
        expect(value, `${theme.id}.${slot}`).toBeTypeOf("string");
        expect(isFillColor(value as string), `${theme.id}.${slot}=${value}`).toBe(true);
      }
      expect(Object.keys(theme.colors).sort()).toEqual([...SCHEME_SLOTS].sort());
    }
  });

  it("offers 16:9 then 4:3 with the Office EMU sizes", () => {
    expect(PPTX_DESIGN_SLIDE_SIZES.map((preset) => preset.id)).toEqual(["16_9", "4_3"]);
    expect(PPTX_DESIGN_SLIDE_SIZES[0]).toMatchObject({ cxEmu: 12192000, cyEmu: 6858000 });
    expect(PPTX_DESIGN_SLIDE_SIZES[1]).toMatchObject({ cxEmu: 9144000, cyEmu: 6858000 });
    for (const preset of PPTX_DESIGN_SLIDE_SIZES) {
      expect(preset.cxEmu).toBeGreaterThan(0);
      expect(preset.cyEmu).toBeGreaterThan(0);
      expect(preset.labelKey).toBe(`office.pptx.design.size.${preset.id}`);
    }
  });
});

describe("buildThemeEdit (apply_theme)", () => {
  it("emits the engine union member with all 12 colors and both fonts", () => {
    const office = PPTX_DESIGN_THEMES.find((theme) => theme.id === "office") as PptxDesignTheme;
    expect(buildThemeEdit(office)).toEqual({
      op: "apply_theme",
      name: "office",
      colors: office.colors,
      majorFont: "Calibri Light",
      minorFont: "Calibri",
    });
  });

  it("omits the fonts a preset does not name and copies the color record", () => {
    const bare: PptxDesignTheme = { id: "bare", nameKey: "office.pptx.design.theme.bare", colors: { lt1: "FFFFFF" } };
    const edit = buildThemeEdit(bare);
    expect(edit).toEqual({ op: "apply_theme", name: "bare", colors: { lt1: "FFFFFF" } });
    // A copy, so a later mutation of the preset cannot retro-change the edit.
    expect(edit.op === "apply_theme" && edit.colors).not.toBe(bare.colors);
  });
});

describe("buildSlideSizeEdit (set_slide_size)", () => {
  it("passes EMU straight through with no px conversion", () => {
    expect(buildSlideSizeEdit(12192000, 6858000)).toEqual({ op: "set_slide_size", cxEmu: 12192000, cyEmu: 6858000 });
    expect(buildSlideSizeEdit(9144000, 6858000)).toEqual({ op: "set_slide_size", cxEmu: 9144000, cyEmu: 6858000 });
  });
});

describe("buildLayoutEdit (set_slide_layout)", () => {
  it("targets the slide with a layout part path", () => {
    expect(buildLayoutEdit(2, "ppt/slideLayouts/slideLayout3.xml")).toEqual({
      op: "set_slide_layout",
      slideIndex: 2,
      layout: "ppt/slideLayouts/slideLayout3.xml",
    });
  });

  it("accepts a 0-based index spelling", () => {
    expect(buildLayoutEdit(0, 1)).toEqual({ op: "set_slide_layout", slideIndex: 0, layout: 1 });
  });

  it("resets to the master layout when no layout is named", () => {
    expect(buildLayoutEdit(4)).toEqual({ op: "set_slide_layout", slideIndex: 4, reset: true });
  });
});

describe("buildBackgroundEdit (set_background)", () => {
  it("emits a solid fill for the one target slide", () => {
    expect(buildBackgroundEdit({ fill: { kind: "solid", color: "#123456" }, slideIndexes: [1] })).toEqual({
      op: "set_background",
      slideIndex: 1,
      kind: "solid",
      color: "#123456",
    });
  });

  it("carries the gradient angle and radial flag when set", () => {
    expect(
      buildBackgroundEdit({ fill: { kind: "gradient", from: "#000000", to: "#FFFFFF", angleDeg: 45, radial: true }, slideIndexes: [0] }),
    ).toEqual({ op: "set_background", slideIndex: 0, kind: "gradient", from: "#000000", to: "#FFFFFF", angleDeg: 45, radial: true });
  });

  it("omits an absent angle and a false radial flag", () => {
    expect(buildBackgroundEdit({ fill: { kind: "gradient", from: "#000000", to: "#FFFFFF" }, slideIndexes: [0] })).toEqual({
      op: "set_background",
      slideIndex: 0,
      kind: "gradient",
      from: "#000000",
      to: "#FFFFFF",
    });
  });

  it("carries image bytes, extension and the tile flag", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(buildBackgroundEdit({ fill: { kind: "image", bytes, ext: "png", tile: true }, slideIndexes: [0] })).toEqual({
      op: "set_background",
      slideIndex: 0,
      kind: "image",
      bytes,
      ext: "png",
      tile: true,
    });
  });

  it("omits a false tile flag on an image fill", () => {
    const bytes = new Uint8Array([9]);
    const edit = buildBackgroundEdit({ fill: { kind: "image", bytes, ext: "jpeg" }, slideIndexes: [0] });
    expect(edit).toEqual({ op: "set_background", slideIndex: 0, kind: "image", bytes, ext: "jpeg" });
    expect(edit).not.toHaveProperty("tile");
  });

  it("emits the reset kind", () => {
    expect(buildBackgroundEdit({ fill: { kind: "reset" }, slideIndexes: [0] })).toEqual({
      op: "set_background",
      slideIndex: 0,
      kind: "reset",
    });
  });

  it("fans 'apply to all' out as an index ARRAY on ONE edit, never N edits", () => {
    const edit = buildBackgroundEdit({ fill: { kind: "solid", color: "#FFFFFF" }, slideIndexes: [0, 1, 2] });
    expect(edit).toEqual({ op: "set_background", slideIndex: [0, 1, 2], kind: "solid", color: "#FFFFFF" });
  });

  it("keeps a single target a number rather than a one-element array", () => {
    const edit = buildBackgroundEdit({ fill: { kind: "solid", color: "#FFFFFF" }, slideIndexes: [3] });
    expect(edit.op === "set_background" && edit.slideIndex).toBe(3);
  });
});

describe("buildGraphicsHiddenEdit", () => {
  it("targets one slide with a number and many with an array", () => {
    expect(buildGraphicsHiddenEdit(true, [2])).toEqual({ op: "set_background", slideIndex: 2, kind: "graphics", hidden: true });
    expect(buildGraphicsHiddenEdit(false, [0, 1, 2])).toEqual({
      op: "set_background",
      slideIndex: [0, 1, 2],
      kind: "graphics",
      hidden: false,
    });
  });
});

describe("slideIndexRange", () => {
  it("lists every 0-based index for the apply-to-all range", () => {
    expect(slideIndexRange(3)).toEqual([0, 1, 2]);
  });

  it("answers an empty range for a deck with no slides or a bad count", () => {
    expect(slideIndexRange(0)).toEqual([]);
    expect(slideIndexRange(-4)).toEqual([]);
    expect(slideIndexRange(Number.NaN)).toEqual([]);
  });
});

describe("matchSlideSizePreset", () => {
  it("names the preset a deck size matches", () => {
    expect(matchSlideSizePreset({ cx: 12192000, cy: 6858000 })).toBe("16_9");
    expect(matchSlideSizePreset({ cx: 9144000, cy: 6858000 })).toBe("4_3");
  });

  it("answers null for a custom size or no size", () => {
    expect(matchSlideSizePreset({ cx: 100, cy: 200 })).toBeNull();
    expect(matchSlideSizePreset(null)).toBeNull();
    expect(matchSlideSizePreset(undefined)).toBeNull();
  });
});

describe("emuToInches", () => {
  it("reads EMU as trimmed inches", () => {
    expect(emuToInches(12192000)).toBe("13.33");
    expect(emuToInches(9144000)).toBe("10");
    expect(emuToInches(6858000)).toBe("7.5");
  });

  it("never prints NaN", () => {
    expect(emuToInches(Number.NaN)).toBe("0");
    expect(emuToInches(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("color helpers", () => {
  it("accepts the 6- and 8-digit hex forms the vendored ops accept", () => {
    expect(isFillColor("#FFFFFF")).toBe(true);
    expect(isFillColor("FFFFFF")).toBe(true);
    expect(isFillColor("#FFFFFF80")).toBe(true);
    expect(isFillColor("#FFF")).toBe(false);
    expect(isFillColor("white")).toBe(false);
    expect(isFillColor("")).toBe(false);
  });

  it("normalizes a valid color to upper-case with a leading #", () => {
    expect(normalizeHex("#ffffff")).toBe("#FFFFFF");
    expect(normalizeHex("ff0000")).toBe("#FF0000");
    expect(normalizeHex("#ffffff80")).toBe("#FFFFFF80");
  });

  it("leaves an invalid or half-typed value alone instead of inventing a color", () => {
    expect(normalizeHex("#ff")).toBe("#ff");
    expect(normalizeHex("  #abc  ")).toBe("#abc");
    expect(normalizeHex("nope")).toBe("nope");
  });
});

describe("themeSwatch", () => {
  it("reads the page background, body text and four accents", () => {
    const office = PPTX_DESIGN_THEMES.find((theme) => theme.id === "office") as PptxDesignTheme;
    expect(themeSwatch(office)).toEqual({
      background: "#FFFFFF",
      foreground: "#000000",
      accents: ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000"],
    });
  });

  it("normalizes a lower-case preset and falls back for a missing slot", () => {
    const custom: PptxDesignTheme = { id: "custom", nameKey: "k", colors: { lt1: "ffffff", dk1: "112233" } };
    expect(themeSwatch(custom)).toEqual({
      background: "#FFFFFF",
      foreground: "#112233",
      accents: ["#888888", "#888888", "#888888", "#888888"],
    });
  });
});

describe("roving focus math", () => {
  it("moves with wrap-around and jumps to the ends", () => {
    expect(nextRovingIndex(0, 3, "ArrowRight")).toBe(1);
    expect(nextRovingIndex(0, 3, "ArrowDown")).toBe(1);
    expect(nextRovingIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextRovingIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextRovingIndex(1, 3, "Home")).toBe(0);
    expect(nextRovingIndex(0, 3, "End")).toBe(2);
  });

  it("leaves a key it does not own alone", () => {
    expect(nextRovingIndex(0, 3, "Enter")).toBeNull();
    expect(nextRovingIndex(0, 3, "Tab")).toBeNull();
    expect(nextRovingIndex(0, 0, "ArrowRight")).toBeNull();
  });

  it("enters on the checked option, else the first", () => {
    expect(rovingEntryIndex(1, 3)).toBe(1);
    expect(rovingEntryIndex(-1, 3)).toBe(0);
    expect(rovingEntryIndex(9, 3)).toBe(0);
    expect(rovingEntryIndex(0, 0)).toBe(0);
  });
});

describe("parseAngleDeg", () => {
  it("accepts a finite degree value and normalizes it into [0, 360)", () => {
    expect(parseAngleDeg("90")).toBe(90);
    expect(parseAngleDeg("-90")).toBe(270);
    expect(parseAngleDeg("450")).toBe(90);
    expect(parseAngleDeg(" 180 ")).toBe(180);
  });

  it("answers null for a value that is not a number, so the caller keeps the last good angle", () => {
    expect(parseAngleDeg("")).toBeNull();
    expect(parseAngleDeg("abc")).toBeNull();
    expect(parseAngleDeg("Infinity")).toBeNull();
  });
});

describe("imageExtension", () => {
  it("prefers the file name's extension", () => {
    expect(imageExtension("bg.PNG")).toBe("png");
    expect(imageExtension("a.b.webp", "image/jpeg")).toBe("webp");
  });

  it("falls back to the MIME subtype, then to png", () => {
    expect(imageExtension("photo", "image/jpeg")).toBe("jpeg");
    expect(imageExtension("photo", "image/svg+xml")).toBe("svg+xml");
    expect(imageExtension("photo")).toBe("png");
    expect(imageExtension("")).toBe("png");
  });
});