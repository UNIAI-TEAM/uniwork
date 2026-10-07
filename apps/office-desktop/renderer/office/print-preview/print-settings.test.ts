import { describe, expect, it } from "vitest";
import { desktopPrintOptionsSchema } from "../../../shared/ipc-print";
import { buildPrintOptions, PAPER_IDS, paperPageSize, parseCopies, parsePageRange, resolveRange } from "./print-settings";

const A4 = { width: 210_000, height: 297_000 };

describe("parsePageRange", () => {
  it("turns the pages the user reads (1-based) into 0-based inclusive spans", () => {
    expect(parsePageRange("1-3,5", 10)).toEqual([{ from: 0, to: 2 }, { from: 4, to: 4 }]);
    expect(parsePageRange(" 2 ,  4 - 6 ", 6)).toEqual([{ from: 1, to: 1 }, { from: 3, to: 5 }]);
    expect(parsePageRange("7", 7)).toEqual([{ from: 6, to: 6 }]);
  });

  it.each(["", "  ", "3-1", "0", "0-2", "11", "1-11", "a", "1-", "-2", "1,,2", "1;2", "1-2-3", "1.5"])("refuses %j on a 10-page document", (text) => {
    expect(parsePageRange(text, 10)).toBeNull();
  });

  it("refuses more spans than the wire carries", () => {
    expect(parsePageRange(Array.from({ length: 101 }, (_, index) => String(index + 1)).join(","), 200)).toBeNull();
    expect(parsePageRange(Array.from({ length: 100 }, (_, index) => String(index + 1)).join(","), 200)).toHaveLength(100);
  });
});

describe("parseCopies", () => {
  it("accepts 1..999 only", () => {
    expect(parseCopies("1")).toBe(1);
    expect(parseCopies(" 999 ")).toBe(999);
    for (const text of ["", "0", "1000", "-1", "2.5", "1e2", "abc"]) expect(parseCopies(text)).toBeNull();
  });
});

describe("resolveRange", () => {
  it("prints everything for all, the shown page for current, and parses a custom span", () => {
    expect(resolveRange("all", "garbage", 2, null)).toEqual({ kind: "all" });
    expect(resolveRange("current", "", 2, 5)).toEqual({ kind: "ranges", ranges: [{ from: 2, to: 2 }] });
    expect(resolveRange("custom", "2-3", 0, 5)).toEqual({ kind: "ranges", ranges: [{ from: 1, to: 2 }] });
  });

  it("waits for the page count before a span can be checked", () => {
    expect(resolveRange("current", "", 0, null)).toEqual({ kind: "invalid", reason: "pending" });
    expect(resolveRange("custom", "1-2", 0, null)).toEqual({ kind: "invalid", reason: "pending" });
  });

  it("tells a typo from a page the document does not have", () => {
    expect(resolveRange("custom", "3-1", 0, 5)).toEqual({ kind: "invalid", reason: "syntax" });
    expect(resolveRange("custom", "0", 0, 5)).toEqual({ kind: "invalid", reason: "syntax" });
    expect(resolveRange("custom", "", 0, 5)).toEqual({ kind: "invalid", reason: "syntax" });
    expect(resolveRange("custom", "6", 0, 5)).toEqual({ kind: "invalid", reason: "bounds" });
    expect(resolveRange("custom", "1-9", 0, 5)).toEqual({ kind: "invalid", reason: "bounds" });
  });
});

describe("paper sizes", () => {
  it("lists the document's own paper first, then the standard sheets, portrait short side first", () => {
    expect(PAPER_IDS).toEqual(["document", "a4", "a3", "a5", "letter", "legal", "tabloid"]);
    expect(paperPageSize("document", { width: 123_000, height: 456_000 })).toEqual({ width: 123_000, height: 456_000 });
    expect(paperPageSize("a4", A4)).toEqual({ width: 210_000, height: 297_000 });
    expect(paperPageSize("letter", A4)).toEqual({ width: 215_900, height: 279_400 });
    for (const paper of PAPER_IDS) {
      const size = paperPageSize(paper, A4);
      expect(size.width).toBeLessThan(size.height);
      expect(desktopPrintOptionsSchema.safeParse({ landscape: false, pageSize: size }).success).toBe(true);
    }
  });
});

describe("buildPrintOptions", () => {
  const base = { landscape: false, pageSize: A4, deviceName: "Office Laser", copies: 1, range: { kind: "all" } as const, color: true, duplex: "simplex" } as const;

  it("names the printer, prints silently and omits pageRanges for all pages", () => {
    const options = buildPrintOptions(base);
    expect(options).toEqual({ landscape: false, pageSize: A4, silent: true, deviceName: "Office Laser", copies: 1, color: true, duplexMode: "simplex" });
    expect("pageRanges" in options).toBe(false);
    expect(desktopPrintOptionsSchema.safeParse(options).success).toBe(true);
  });

  it("carries orientation, paper, copies, colour, duplex and the resolved spans", () => {
    const options = buildPrintOptions({ ...base, landscape: true, pageSize: { width: 297_000, height: 420_000 }, copies: 12, color: false, duplex: "shortEdge", range: { kind: "ranges", ranges: [{ from: 0, to: 2 }, { from: 4, to: 4 }] } });
    expect(options).toMatchObject({ landscape: true, pageSize: { width: 297_000, height: 420_000 }, copies: 12, color: false, duplexMode: "shortEdge", pageRanges: [{ from: 0, to: 2 }, { from: 4, to: 4 }] });
    expect(desktopPrintOptionsSchema.parse(options)).toEqual(options);
  });

  it("never invents a span for a range that is not settled", () => {
    expect("pageRanges" in buildPrintOptions({ ...base, range: { kind: "invalid", reason: "pending" } })).toBe(false);
  });
});
