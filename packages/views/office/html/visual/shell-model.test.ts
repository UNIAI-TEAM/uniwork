import { describe, expect, it } from "vitest";
import {
  clampZoom,
  HTML_VIEW_MODES,
  HTML_ZOOM_DEFAULT,
  HTML_ZOOM_MAX,
  HTML_ZOOM_MIN,
  HTML_ZOOM_STEP,
  htmlStatusFigures,
  nextViewMode,
  previewVisibleIn,
  sourceVisibleIn,
  type HtmlViewMode,
} from "./shell-model";

describe("nextViewMode", () => {
  it("cycles source -> split -> preview -> present -> source", () => {
    expect(nextViewMode("source")).toBe("split");
    expect(nextViewMode("split")).toBe("preview");
    expect(nextViewMode("preview")).toBe("present");
    expect(nextViewMode("present")).toBe("source");
  });

  it("visits every mode exactly once per full cycle", () => {
    const seen: HtmlViewMode[] = [];
    let mode: HtmlViewMode = "source";
    for (let index = 0; index < HTML_VIEW_MODES.length; index += 1) {
      seen.push(mode);
      mode = nextViewMode(mode);
    }
    expect(seen).toEqual([...HTML_VIEW_MODES]);
    expect(mode).toBe("source");
  });
});

describe("pane visibility", () => {
  it("shows the source in source and split only", () => {
    expect(sourceVisibleIn("source")).toBe(true);
    expect(sourceVisibleIn("split")).toBe(true);
    expect(sourceVisibleIn("preview")).toBe(false);
    expect(sourceVisibleIn("present")).toBe(false);
  });

  it("shows the preview in split, preview and present", () => {
    expect(previewVisibleIn("split")).toBe(true);
    expect(previewVisibleIn("preview")).toBe(true);
    expect(previewVisibleIn("present")).toBe(true);
    expect(previewVisibleIn("source")).toBe(false);
  });
});

describe("zoom ladder", () => {
  it("clamps to the allowed range and rounds to whole percent", () => {
    expect(clampZoom(0)).toBe(HTML_ZOOM_MIN);
    expect(clampZoom(10_000)).toBe(HTML_ZOOM_MAX);
    expect(clampZoom(100.4)).toBe(100);
    expect(clampZoom(Number.NaN)).toBe(HTML_ZOOM_DEFAULT);
  });

  it("steps by the fixed increment and never wraps past the ends", () => {
    expect(clampZoom(HTML_ZOOM_DEFAULT) + HTML_ZOOM_STEP).toBe(110);
    // stepZoom lives on the shell; here we pin the arithmetic the shell uses.
    expect(clampZoom(HTML_ZOOM_MIN + -1 * HTML_ZOOM_STEP)).toBe(HTML_ZOOM_MIN);
    expect(clampZoom(HTML_ZOOM_MAX + 1 * HTML_ZOOM_STEP)).toBe(HTML_ZOOM_MAX);
  });
});

describe("htmlStatusFigures", () => {
  it("counts characters and lines of the raw source", () => {
    expect(htmlStatusFigures("", null)).toMatchObject({ length: 0, lines: 1, selection: null });
    expect(htmlStatusFigures("a\nb\nc", null)).toMatchObject({ length: 5, lines: 3 });
  });

  it("keeps a real selection and drops an empty one", () => {
    expect(htmlStatusFigures("hello", { from: 1, to: 4 }).selection).toEqual({ from: 1, to: 4 });
    expect(htmlStatusFigures("hello", { from: 2, to: 2 }).selection).toBeNull();
    expect(htmlStatusFigures("hello", { from: 4, to: 1 }).selection).toBeNull();
  });
});
