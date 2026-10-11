// Pure planning helpers of the text rebuild: selection-style alignment through the
// NFKC fold, style overlays and line segmentation by measured advance.
import { describe, expect, it } from "vitest";

import {
  editStyleRuns,
  overlayStyles,
  plannedCharStyles,
  PreserveAbort,
  segmentLine,
} from "./text-plan.ts";
import type { RunStyle } from "./text-plan.ts";

const RED = [255, 0, 0] as const;
const BLUE = [0, 0, 255] as const;

describe("editStyleRuns", () => {
  it("prefers styleRuns over the legacy colorRuns", () => {
    const styleRuns = [{ start: 0, end: 1, bold: true }];
    const colorRuns = [{ start: 0, end: 1, color: [1, 2, 3] as [number, number, number] }];
    expect(editStyleRuns({ styleRuns, colorRuns })).toBe(styleRuns);
  });

  it("falls back to colorRuns from older senders", () => {
    const colorRuns = [{ start: 0, end: 1, color: [1, 2, 3] as [number, number, number] }];
    expect(editStyleRuns({ colorRuns })).toBe(colorRuns);
    expect(editStyleRuns({})).toBeUndefined();
  });
});

describe("plannedCharStyles", () => {
  it("returns null when the edit has no runs", () => {
    expect(plannedCharStyles({ newText: "abc" }, "abc")).toBeNull();
    expect(plannedCharStyles({ newText: "abc", styleRuns: [] }, "abc")).toBeNull();
  });

  it("styles the run's characters and lets a trailing space join the segment", () => {
    const out = plannedCharStyles(
      { newText: "abc def", styleRuns: [{ start: 0, end: 3, bold: true }] },
      "abc def",
    )!;
    expect(out).toHaveLength(7);
    expect(out[0]).toEqual(expect.objectContaining({ bold: true }));
    expect(out[3]).toBe(out[0]);
    expect(out[4]).toBeNull();
    expect(out[6]).toBeNull();
  });

  it("shifts the runs onto a planned text that wraps container text around the edit", () => {
    const out = plannedCharStyles(
      { newText: "new", styleRuns: [{ start: 0, end: 3, color: [...RED] }] },
      "left new right",
    )!;
    expect(out.slice(0, 5)).toEqual([null, null, null, null, null].map(() => null));
    expect(out[5]?.color).toEqual([...RED]);
    expect(out[7]?.color).toEqual([...RED]);
    expect(out[8]).toBe(out[7]); // the space after the styled word
    expect(out[9]).toBeNull();
  });

  it("aligns through the NFKC fold so engine variants still receive the style", () => {
    // The planned text holds the ligature char the user typed as two letters
    const out = plannedCharStyles(
      { newText: "fi", colorRuns: [{ start: 0, end: 2, color: [...BLUE] as [number, number, number] }] },
      "ﬁ",
    )!;
    expect(out).toHaveLength(1);
    expect(out[0]?.color).toEqual([...BLUE]);
  });

  it("returns null when the user's units cannot be found in the planned text", () => {
    expect(
      plannedCharStyles({ newText: "abc", styleRuns: [{ start: 0, end: 3, bold: true }] }, "xyz"),
    ).toBeNull();
  });

  it("returns null when no planned character falls inside a run", () => {
    expect(
      plannedCharStyles({ newText: "ab", styleRuns: [{ start: 5, end: 9, bold: true }] }, "ab"),
    ).toBeNull();
  });

  it("does not attach a newline to the preceding segment", () => {
    const out = plannedCharStyles(
      { newText: "ab\ncd", styleRuns: [{ start: 0, end: 2, italic: true }] },
      "ab\ncd",
    )!;
    expect(out[1]?.italic).toBe(true);
    expect(out[2]).toBeNull();
  });
});

describe("overlayStyles", () => {
  it("returns null when there is nothing to overlay", () => {
    expect(overlayStyles(null, null, "abc")).toBeNull();
    expect(overlayStyles([null, null, null], [null, null, null], "abc")).toBeNull();
  });

  it("shares one colour-only style per preserved colour", () => {
    const out = overlayStyles([RED, RED, null], null, "abc")!;
    expect(out[0]).toEqual({ color: RED });
    expect(out[1]).toBe(out[0]);
    expect(out[2]).toBeNull();
  });

  it("keeps the preserved fill under a styled range that sets no colour", () => {
    const bold: RunStyle = { bold: true };
    const out = overlayStyles([RED, RED], [bold, null], "ab")!;
    expect(out[0]).toEqual({ bold: true, color: RED });
    expect(out[1]).toEqual({ color: RED });
  });

  it("lets an explicit user colour win over the preserved one", () => {
    const user: RunStyle = { color: BLUE };
    const out = overlayStyles([RED], [user], "a")!;
    expect(out[0]).toBe(user);
  });

  it("passes a style through when no preserved colour exists", () => {
    const bold: RunStyle = { bold: true };
    expect(overlayStyles(null, [bold], "a")![0]).toBe(bold);
  });

  it("attaches whitespace to the preceding char but never a newline", () => {
    const out = overlayStyles([RED, null, null, null], null, "a b\nc".slice(0, 4))!;
    expect(out[1]).toBe(out[0]);
    expect(out[3]).toBeNull();
    const nl = overlayStyles([RED, null, null], null, "a\nb")!;
    expect(nl[1]).toBeNull();
  });
});

describe("segmentLine", () => {
  const ten = () => 10;

  it("returns one base segment without styles", () => {
    expect(segmentLine("abc", null, ten)).toEqual([{ text: "abc", style: null, xPt: 0 }]);
  });

  it("returns one base segment for an empty line even with styles", () => {
    expect(segmentLine("", [], ten)).toEqual([{ text: "", style: null, xPt: 0 }]);
  });

  it("keeps a uniformly styled line as one segment at x 0", () => {
    const s: RunStyle = { bold: true };
    expect(segmentLine("ab", [s, s], ten)).toEqual([{ text: "ab", style: s, xPt: 0 }]);
  });

  it("splits at style boundaries and offsets each segment by the advance before it", () => {
    const s: RunStyle = { color: RED };
    const segs = segmentLine("abcd", [s, s, null, null], ten);
    expect(segs).toEqual([
      { text: "ab", style: s, xPt: 0 },
      { text: "cd", style: null, xPt: 20 },
    ]);
  });

  it("compares styles by value, not reference", () => {
    const a: RunStyle = { color: RED, size: 12 };
    const b: RunStyle = { color: [...RED], size: 12 };
    const segs = segmentLine("abc", [a, b, null], ten);
    expect(segs.map((s) => s.text)).toEqual(["ab", "c"]);
  });

  it("splits segments where bold or italic changes", () => {
    const segs = segmentLine("abc", [{ bold: true }, { bold: false }, { italic: true }], ten);
    expect(segs.map((s) => s.text)).toEqual(["a", "b", "c"]);
  });

  it("measures the face that draws each segment", () => {
    const wide: RunStyle = { size: 20 };
    const adv = (_cp: number, s: RunStyle | null) => (s?.size ?? 10);
    const segs = segmentLine("abc", [wide, wide, null], adv);
    expect(segs[1]!.xPt).toBe(40);
  });

  it("counts a surrogate pair once when measuring", () => {
    const s: RunStyle = { bold: true };
    const seen: number[] = [];
    const segs = segmentLine("😀b", [s, s, null], (cp) => {
      seen.push(cp);
      return 5;
    });
    expect(seen).toEqual([0x1f600, 0x62]);
    expect(segs[1]).toEqual({ text: "b", style: null, xPt: 5 });
  });

  it("degrades to one unstyled segment when a character cannot be measured", () => {
    const s: RunStyle = { bold: true };
    const segs = segmentLine("abc", [s, null, null], (cp) => (cp === 0x61 ? null : 10));
    expect(segs).toEqual([{ text: "abc", style: null, xPt: 0 }]);
  });
});

describe("PreserveAbort", () => {
  it("is an Error so callers can tell it apart from real failures", () => {
    const e = new PreserveAbort();
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(PreserveAbort);
  });
});
