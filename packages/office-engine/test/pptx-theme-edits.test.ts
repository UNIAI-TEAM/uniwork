// B1e (UNI-927) — design-op builder tests (themes, slide size, backgrounds,
// slide layouts).
//
// Vendored guard first: every op these builders can emit must exist in the
// vendored pptx-ops sources as `name: '<op>'`. Op objects are compared
// strictly (absent optionals stay absent), refusals branch on typed
// PptxEngineError codes, and sizes stay EMU — no px→EMU conversion happens in
// this area. The edit → savePptx → reopen round-trip is the wire round.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildThemeOps, type OpenedPptxLike, type ThemeEdit } from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

/** Plain deck fixture: two slides — enough for slide-exists validation. */
const opened: OpenedPptxLike = {
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      { id: "s1", elements: [] },
      { id: "s2", elements: [] },
    ],
  },
};

const build = (edit: ThemeEdit) => buildThemeOps(opened, 960, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

describe("design vendored guard", () => {
  it("emits only op names registered in the vendored slide-ops source", () => {
    const source = readVendored("pptx-ops/src/ops/slide-ops.ts");
    // The exact registry lines B1e binds to (slide-ops.ts:296/318/382/730).
    const emitted = [
      ...build({ op: "apply_theme", name: "Aurora", colors: { lt1: "#FFFFFF", dk1: "#000000" } }),
      ...build({ op: "set_slide_size", cxEmu: 12192000, cyEmu: 6858000 }),
      ...build({ op: "set_background", slideIndex: 0, kind: "solid", color: "#112233" }),
      ...build({ op: "set_slide_layout", slideIndex: 0, layout: "Title Slide" }),
    ];
    expect(emitted.map((op) => op.op).sort()).toStrictEqual([
      "applyTheme",
      "setBackground",
      "setSlideLayout",
      "setSlideSize",
    ]);
    for (const op of emitted) {
      expect(source).toContain("name: '" + op.op + "'");
    }
  });
});

describe("apply_theme op building", () => {
  const colors = { dk1: "#000000", lt1: "#FFFFFF", accent1: "#445566" };

  it("builds the exact applyTheme op with fonts when supplied", () => {
    expect(
      build({ op: "apply_theme", name: "Aurora", colors, majorFont: "Inter Display", minorFont: "Inter" }),
    ).toStrictEqual([
      { op: "applyTheme", name: "Aurora", colors, majorFont: "Inter Display", minorFont: "Inter" },
    ]);
  });

  it("omits blank font names and passes '#'-less hex through (vendored accepts both)", () => {
    expect(build({ op: "apply_theme", name: "Aurora", colors: { dk1: "000000" }, majorFont: "" })).toStrictEqual([
      { op: "applyTheme", name: "Aurora", colors: { dk1: "000000" } },
    ]);
  });
});

describe("set_slide_size op building", () => {
  it("builds the exact setSlideSize op in EMU (cx/cy are not px-converted)", () => {
    expect(build({ op: "set_slide_size", cxEmu: 12192000, cyEmu: 6858000 })).toStrictEqual([
      { op: "setSlideSize", cx: 12192000, cy: 6858000 },
    ]);
  });

  it("is independent of fitWidthPx — this area is EMU by design", () => {
    const edit: ThemeEdit = { op: "set_slide_size", cxEmu: 9144000, cyEmu: 5143500 };
    expect(buildThemeOps(opened, 1920, edit)).toStrictEqual(buildThemeOps(opened, 960, edit));
  });
});

describe("set_background op building", () => {
  it("builds the exact solid op", () => {
    expect(build({ op: "set_background", slideIndex: 1, kind: "solid", color: "#0B1F3A" })).toStrictEqual([
      { op: "setBackground", target: { slide: 1 }, kind: "solid", color: "#0B1F3A" },
    ]);
  });

  it("builds gradient ops with angle and radial variants", () => {
    expect(
      build({ op: "set_background", slideIndex: 0, kind: "gradient", from: "#000000", to: "#FFFFFF", angleDeg: 45 }),
    ).toStrictEqual([
      {
        op: "setBackground",
        target: { slide: 0 },
        kind: "gradient",
        from: "#000000",
        to: "#FFFFFF",
        angleDeg: 45,
      },
    ]);
    expect(
      build({ op: "set_background", slideIndex: 0, kind: "gradient", from: "#111111", to: "#222222", radial: true }),
    ).toStrictEqual([
      { op: "setBackground", target: { slide: 0 }, kind: "gradient", from: "#111111", to: "#222222", radial: true },
    ]);
  });

  it("builds image ops with source bytes/ext and optional tiling", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(build({ op: "set_background", slideIndex: 0, kind: "image", bytes, ext: "png", tile: true })).toStrictEqual([
      { op: "setBackground", target: { slide: 0 }, kind: "image", source: { bytes, ext: "png" }, tile: true },
    ]);
    expect(build({ op: "set_background", slideIndex: 0, kind: "image", bytes, ext: "png" })[0]).toStrictEqual({
      op: "setBackground",
      target: { slide: 0 },
      kind: "image",
      source: { bytes, ext: "png" },
    });
  });

  it("builds reset and graphics-hidden ops", () => {
    expect(build({ op: "set_background", slideIndex: 0, kind: "reset" })).toStrictEqual([
      { op: "setBackground", target: { slide: 0 }, kind: "reset" },
    ]);
    expect(build({ op: "set_background", slideIndex: 0, kind: "graphics", hidden: true })).toStrictEqual([
      { op: "setBackground", target: { slide: 0 }, kind: "graphics", hidden: true },
    ]);
    expect(build({ op: "set_background", slideIndex: 0, kind: "graphics" })[0]).toStrictEqual({
      op: "setBackground",
      target: { slide: 0 },
      kind: "graphics",
      hidden: false,
    });
  });

  it("accepts 8-digit hex fills (vendored requireHexColor allows alpha)", () => {
    expect(build({ op: "set_background", slideIndex: 0, kind: "solid", color: "#11223344" })[0]).toStrictEqual({
      op: "setBackground",
      target: { slide: 0 },
      kind: "solid",
      color: "#11223344",
    });
  });

  it("fans an index array out to one op per slide, in selection order", () => {
    expect(build({ op: "set_background", slideIndex: [1, 0], kind: "solid", color: "#FFFFFF" })).toStrictEqual([
      { op: "setBackground", target: { slide: 1 }, kind: "solid", color: "#FFFFFF" },
      { op: "setBackground", target: { slide: 0 }, kind: "solid", color: "#FFFFFF" },
    ]);
  });
});

describe("set_slide_layout op building", () => {
  it("builds layout by name, by 0-based index (falsy), and by part path", () => {
    expect(build({ op: "set_slide_layout", slideIndex: 0, layout: "Title Slide" })).toStrictEqual([
      { op: "setSlideLayout", target: { slide: 0 }, layout: "Title Slide" },
    ]);
    expect(build({ op: "set_slide_layout", slideIndex: 0, layout: 0 })).toStrictEqual([
      { op: "setSlideLayout", target: { slide: 0 }, layout: 0 },
    ]);
    expect(build({ op: "set_slide_layout", slideIndex: 1, layout: "ppt/slideLayouts/slideLayout1.xml" })).toStrictEqual([
      { op: "setSlideLayout", target: { slide: 1 }, layout: "ppt/slideLayouts/slideLayout1.xml" },
    ]);
  });

  it("builds the reset op with neither layout nor layoutPath (master layout)", () => {
    expect(build({ op: "set_slide_layout", slideIndex: 1, reset: true })).toStrictEqual([
      { op: "setSlideLayout", target: { slide: 1 } },
    ]);
  });
});

describe("design refusals", () => {
  it("refuses an empty or blank theme name with bad_theme_name", () => {
    expect(errCode(() => build({ op: "apply_theme", name: "", colors: { lt1: "#FFFFFF" } }))).toBe("bad_theme_name");
    expect(errCode(() => build({ op: "apply_theme", name: "   ", colors: { lt1: "#FFFFFF" } }))).toBe("bad_theme_name");
    expect(errCode(() => build({ op: "apply_theme", colors: { lt1: "#FFFFFF" } } as unknown as ThemeEdit))).toBe(
      "bad_theme_name",
    );
  });

  it("refuses malformed theme colors with bad_theme_color", () => {
    const theme = (colors: unknown): ThemeEdit => ({ op: "apply_theme", name: "Aurora", colors }) as ThemeEdit;
    expect(errCode(() => build(theme({ dk1: "red" })))).toBe("bad_theme_color");
    expect(errCode(() => build(theme({ dk1: "#12345" })))).toBe("bad_theme_color");
    expect(errCode(() => build(theme({ dk1: "#1234567" })))).toBe("bad_theme_color");
    expect(errCode(() => build(theme({ dk1: 5 })))).toBe("bad_theme_color");
    expect(errCode(() => build(theme(null)))).toBe("bad_theme_color");
    expect(errCode(() => build(theme(["#FFFFFF"])))).toBe("bad_theme_color");
  });

  it("refuses non-positive or non-finite slide sizes with bad_slide_size", () => {
    const size = (cxEmu: number, cyEmu: number): ThemeEdit => ({ op: "set_slide_size", cxEmu, cyEmu });
    expect(errCode(() => build(size(0, 6858000)))).toBe("bad_slide_size");
    expect(errCode(() => build(size(12192000, -1)))).toBe("bad_slide_size");
    expect(errCode(() => build(size(Number.NaN, 6858000)))).toBe("bad_slide_size");
    expect(errCode(() => build(size(Number.POSITIVE_INFINITY, 6858000)))).toBe("bad_slide_size");
    expect(errCode(() => build({ op: "set_slide_size", cxEmu: 12192000 } as unknown as ThemeEdit))).toBe(
      "bad_slide_size",
    );
  });

  it("refuses malformed backgrounds with bad_background", () => {
    const bg = (fields: Record<string, unknown>): ThemeEdit =>
      ({ op: "set_background", slideIndex: 0, ...fields }) as unknown as ThemeEdit;
    expect(errCode(() => build(bg({ kind: "video" })))).toBe("bad_background");
    expect(errCode(() => build(bg({ kind: "solid" })))).toBe("bad_background");
    expect(errCode(() => build(bg({ kind: "solid", color: "zzz" })))).toBe("bad_background");
    expect(errCode(() => build(bg({ kind: "gradient", from: "#000000" })))).toBe("bad_background");
    expect(errCode(() => build(bg({ kind: "gradient", from: "#000000", to: "#ffffff", angleDeg: Number.NaN })))).toBe(
      "bad_background",
    );
    expect(errCode(() => build(bg({ kind: "image" })))).toBe("bad_background");
    expect(errCode(() => build(bg({ kind: "image", bytes: new Uint8Array(), ext: "png" })))).toBe("bad_background");
    expect(errCode(() => build(bg({ kind: "image", bytes: new Uint8Array([1]), ext: "" })))).toBe("bad_background");
  });

  it("refuses malformed layouts with bad_layout", () => {
    const layout = (fields: Record<string, unknown>): ThemeEdit =>
      ({ op: "set_slide_layout", slideIndex: 0, ...fields }) as unknown as ThemeEdit;
    expect(errCode(() => build(layout({})))).toBe("bad_layout");
    expect(errCode(() => build(layout({ layout: -1 })))).toBe("bad_layout");
    expect(errCode(() => build(layout({ layout: 1.5 })))).toBe("bad_layout");
    expect(errCode(() => build(layout({ layout: "  " })))).toBe("bad_layout");
    expect(errCode(() => build(layout({ layout: null })))).toBe("bad_layout");
    expect(errCode(() => build(layout({ layout: "Title Slide", reset: true })))).toBe("bad_layout");
  });

  it("refuses missing slides with no_slide", () => {
    expect(errCode(() => build({ op: "set_background", slideIndex: 9, kind: "reset" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_background", slideIndex: -1, kind: "reset" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_background", slideIndex: 1.5, kind: "reset" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_background", slideIndex: [], kind: "reset" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_background", slideIndex: [0, 9], kind: "reset" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_slide_layout", slideIndex: 9, reset: true }))).toBe("no_slide");
  });

  it("refuses an unknown edit kind with unsupported_edit", () => {
    expect(errCode(() => build({ op: "nope" } as unknown as ThemeEdit))).toBe("unsupported_edit");
  });
});
