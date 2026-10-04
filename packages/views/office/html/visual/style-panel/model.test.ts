import { describe, expect, it } from "vitest";
// Imported through the barrel: this test is what keeps the panel's public
// surface (index.ts) reachable, so knip does not read the barrel as dead code.
import {
  applyAspectLock,
  clampOpacity,
  clampStyleSize,
  CUSTOM_CSS_MAX_LENGTH,
  defaultHtmlStyleValues,
  fontFamilyFromSelectValue,
  HTML_STYLE_FONT_INHERIT,
  isPlainCssString,
  mergeHtmlStyleValues,
  normalizeCustomCss,
  normalizeHexColour,
  selectValueForFontFamily,
  STYLE_OPACITY_DEFAULT,
  type HtmlStyleSize,
  type HtmlStyleValues,
} from "./index";

function size(overrides: Partial<HtmlStyleSize> = {}): HtmlStyleSize {
  return { width: null, height: null, aspectLocked: false, aspectRatio: null, ...overrides };
}

describe("clampStyleSize", () => {
  it("rounds and keeps a value inside the bounds", () => {
    expect(clampStyleSize(320.4)).toBe(320);
    expect(clampStyleSize(0)).toBe(1);
    expect(clampStyleSize(-40)).toBe(1);
    expect(clampStyleSize(1e9)).toBe(8192);
  });

  it("answers null for anything that is not a finite number", () => {
    expect(clampStyleSize(null)).toBeNull();
    expect(clampStyleSize(undefined)).toBeNull();
    expect(clampStyleSize(Number.NaN)).toBeNull();
    expect(clampStyleSize(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("clampOpacity", () => {
  it("is a whole percent in 0-100", () => {
    expect(clampOpacity(49.6)).toBe(50);
    expect(clampOpacity(-10)).toBe(0);
    expect(clampOpacity(1000)).toBe(100);
  });

  it("falls back to the default for a broken value", () => {
    expect(clampOpacity(Number.NaN)).toBe(STYLE_OPACITY_DEFAULT);
    expect(clampOpacity(null)).toBe(STYLE_OPACITY_DEFAULT);
  });
});

describe("applyAspectLock", () => {
  it("changes only the edited side when the lock is off", () => {
    const next = applyAspectLock(size({ width: 100, height: 50 }), "width", 200);
    expect(next).toEqual({ width: 200, height: 50, aspectLocked: false, aspectRatio: null });
  });

  it("keeps the ratio when the lock is on and the ratio is known", () => {
    const locked = size({ width: 200, height: 100, aspectLocked: true, aspectRatio: 2 });
    expect(applyAspectLock(locked, "width", 400)).toMatchObject({ width: 400, height: 200 });
    expect(applyAspectLock(locked, "height", 50)).toMatchObject({ width: 100, height: 50 });
  });

  it("rounds the derived side the same way it rounds a typed one", () => {
    // ratio 3 -> height 100/3 = 33.33 -> 33
    const locked = size({ width: 300, height: 100, aspectLocked: true, aspectRatio: 3 });
    expect(applyAspectLock(locked, "width", 100).height).toBe(33);
  });

  it("keeps the box square when the lock is on but no ratio is known", () => {
    const locked = size({ width: 10, height: 20, aspectLocked: true, aspectRatio: null });
    expect(applyAspectLock(locked, "width", 64)).toMatchObject({ width: 64, height: 64 });
    expect(applyAspectLock(locked, "height", 48)).toMatchObject({ width: 48, height: 48 });
  });

  it("clears only the edited side, and never derives from nothing", () => {
    const locked = size({ width: 200, height: 100, aspectLocked: true, aspectRatio: 2 });
    expect(applyAspectLock(locked, "width", null)).toMatchObject({ width: null, height: 100 });
    expect(applyAspectLock(locked, "height", null)).toMatchObject({ width: 200, height: null });
  });

  it("ignores an unusable ratio instead of emitting a NaN side", () => {
    const locked = size({ width: 200, height: 100, aspectLocked: true, aspectRatio: 0 });
    const next = applyAspectLock(locked, "width", 300);
    expect(next.width).toBe(300);
    expect(Number.isFinite(next.height as number)).toBe(true);
  });
});

describe("mergeHtmlStyleValues", () => {
  const base: HtmlStyleValues = {
    ...defaultHtmlStyleValues(),
    fontFamily: "Arial",
    size: { width: 100, height: 100, aspectLocked: false, aspectRatio: 1 },
    customCss: "color: red",
  };

  it("moves only the fields the patch carries", () => {
    const next = mergeHtmlStyleValues(base, { opacity: 40 });
    expect(next.opacity).toBe(40);
    expect(next.fontFamily).toBe("Arial");
    expect(next.size).toEqual(base.size);
    expect(next.customCss).toBe("color: red");
  });

  it("treats an explicit null as a clear, not as a missing field", () => {
    const next = mergeHtmlStyleValues(base, { typography: { fontFamily: null }, background: null });
    expect(next.fontFamily).toBeNull();
    expect(next.background).toBeNull();
  });

  it("clamps sizes and opacity on the way in", () => {
    const next = mergeHtmlStyleValues(base, { size: { width: 1e9 }, opacity: 999 });
    expect(next.size.width).toBe(8192);
    expect(next.opacity).toBe(100);
  });

  it("keeps the natural ratio the caller read off the element", () => {
    const next = mergeHtmlStyleValues(base, { size: { aspectLocked: true } });
    expect(next.size.aspectRatio).toBe(1);
    expect(next.size.aspectLocked).toBe(true);
  });
});

describe("custom CSS is text, never markup", () => {
  it("accepts only a string", () => {
    expect(isPlainCssString("color:red")).toBe(true);
    expect(isPlainCssString(42)).toBe(false);
    expect(isPlainCssString(null)).toBe(false);
    expect(isPlainCssString({ css: "x" })).toBe(false);
  });

  it("passes the string through with NUL stripped and the length capped", () => {
    expect(normalizeCustomCss("color: red;")).toBe("color: red;");
    expect(normalizeCustomCss("a\u0000b")).toBe("ab");
    expect(normalizeCustomCss("x".repeat(CUSTOM_CSS_MAX_LENGTH + 50))).toHaveLength(CUSTOM_CSS_MAX_LENGTH);
  });

  it("turns a non-string into an empty string rather than stringifying it", () => {
    expect(normalizeCustomCss(null)).toBe("");
    expect(normalizeCustomCss({ toString: () => "color:red" })).toBe("");
  });
});

describe("normalizeHexColour", () => {
  it("expands a short hex and lowercases a long one", () => {
    expect(normalizeHexColour("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColour("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHexColour("  #ffffff ")).toBe("#ffffff");
  });

  it("refuses anything that is not a plain hex colour", () => {
    for (const value of ["red", "rgb(1,2,3)", "#12345", "url(x)", "javascript:alert(1)", 12, null, "#ggg"]) {
      expect(normalizeHexColour(value), String(value)).toBeNull();
    }
  });
});

describe("font-family select value", () => {
  it("round-trips a family and the inherit sentinel", () => {
    expect(selectValueForFontFamily("Arial")).toBe("Arial");
    expect(selectValueForFontFamily(null)).toBe(HTML_STYLE_FONT_INHERIT);
    expect(fontFamilyFromSelectValue("Arial")).toBe("Arial");
    expect(fontFamilyFromSelectValue(HTML_STYLE_FONT_INHERIT)).toBeNull();
  });
});

describe("defaultHtmlStyleValues", () => {
  it("starts unset, fully opaque, with no custom CSS", () => {
    const values = defaultHtmlStyleValues();
    expect(values.fontFamily).toBeNull();
    expect(values.fontWeight).toBeNull();
    expect(values.textAlign).toBeNull();
    expect(values.background).toBeNull();
    expect(values.alt).toBeNull();
    expect(values.fit).toBeNull();
    expect(values.opacity).toBe(STYLE_OPACITY_DEFAULT);
    expect(values.customCss).toBe("");
    expect(values.size).toEqual({ width: null, height: null, aspectLocked: false, aspectRatio: null });
  });
});
