import { describe, expect, it } from "vitest";
import { desktopPrintOptionsSchema, desktopPrintSavePdfRequestSchema } from "../../../shared/ipc-print";
import { buildPrintOptions, buildSavePdfOptions, initialPrintForm, PAPER_IDS, paperPageSize, parseCopies, parsePageRange, resolveDestination, resolveRange, SAVE_PDF_DESTINATION } from "./print-settings";

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
  const base = { landscape: false, pageSize: A4, deviceName: "Office Laser", copies: 1, range: { kind: "all" } as const, color: "default", duplex: "default" } as const;

  it("names the printer, prints silently and omits pageRanges for all pages", () => {
    const options = buildPrintOptions(base);
    expect(options).toEqual({ landscape: false, pageSize: A4, silent: true, deviceName: "Office Laser", copies: 1 });
    expect("pageRanges" in options).toBe(false);
    expect(desktopPrintOptionsSchema.safeParse(options).success).toBe(true);
  });

  it("leaves colour and duplex to the printer unless the user chose them", () => {
    const untouched = buildPrintOptions(base);
    expect("color" in untouched).toBe(false);
    expect("duplexMode" in untouched).toBe(false);
    expect(buildPrintOptions({ ...base, color: "color" })).toMatchObject({ color: true });
    expect("duplexMode" in buildPrintOptions({ ...base, color: "color" })).toBe(false);
    expect(buildPrintOptions({ ...base, duplex: "simplex" })).toMatchObject({ duplexMode: "simplex" });
    expect("color" in buildPrintOptions({ ...base, duplex: "simplex" })).toBe(false);
  });

  it("starts the form on the printer defaults", () => {
    expect(initialPrintForm({ landscape: false, pageSize: A4 })).toMatchObject({ color: "default", duplex: "default" });
  });

  it("carries orientation, paper, copies, colour, duplex and the resolved spans", () => {
    const options = buildPrintOptions({ ...base, landscape: true, pageSize: { width: 297_000, height: 420_000 }, copies: 12, color: "mono", duplex: "shortEdge", range: { kind: "ranges", ranges: [{ from: 0, to: 2 }, { from: 4, to: 4 }] } });
    expect(options).toMatchObject({ landscape: true, pageSize: { width: 297_000, height: 420_000 }, copies: 12, color: false, duplexMode: "shortEdge", pageRanges: [{ from: 0, to: 2 }, { from: 4, to: 4 }] });
    expect(desktopPrintOptionsSchema.parse(options)).toEqual(options);
  });

  it("never invents a span for a range that is not settled", () => {
    expect("pageRanges" in buildPrintOptions({ ...base, range: { kind: "invalid", reason: "pending" } })).toBe(false);
  });
});

describe("resolveDestination", () => {
  const laser = { name: "Office Laser", displayName: "Office Laser", isDefault: false, needsSystemDialog: false };
  const desk = { name: "Front Desk", displayName: "Front Desk", isDefault: true, needsSystemDialog: false };
  const stock = { name: "Microsoft Print to PDF", displayName: "Microsoft Print to PDF", isDefault: false, needsSystemDialog: true };

  it("defaults to the OS default printer, else the first, when it prints silently", () => {
    expect(resolveDestination("", [laser, desk])).toEqual({ kind: "printer", name: "Front Desk" });
    expect(resolveDestination("", [laser])).toEqual({ kind: "printer", name: "Office Laser" });
  });

  it("prefers Save as PDF over a default that needs the system dialog, and when there is no printer", () => {
    expect(resolveDestination("", [{ ...stock, isDefault: true }, laser])).toEqual({ kind: "save-pdf" });
    expect(resolveDestination("", [stock])).toEqual({ kind: "save-pdf" });
    expect(resolveDestination("", [])).toEqual({ kind: "save-pdf" });
  });

  it("honours a pick: a plain printer, the system-dialog queue, or the Save as PDF sentinel", () => {
    expect(resolveDestination("Office Laser", [laser, desk])).toEqual({ kind: "printer", name: "Office Laser" });
    expect(resolveDestination(stock.name, [laser, stock])).toEqual({ kind: "system-dialog", name: stock.name });
    expect(resolveDestination(SAVE_PDF_DESTINATION, [laser])).toEqual({ kind: "save-pdf" });
    expect(resolveDestination(SAVE_PDF_DESTINATION, [])).toEqual({ kind: "save-pdf" });
  });

  it("uses a sentinel no printer name can equal", () => {
    expect(SAVE_PDF_DESTINATION).toContain("\u0000");
  });
});

describe("buildSavePdfOptions", () => {
  it("carries the sheet and omits pageRanges for all pages", () => {
    const options = buildSavePdfOptions({ landscape: true, pageSize: A4, range: { kind: "all" } });
    expect(options).toEqual({ landscape: true, pageSize: A4 });
    expect("pageRanges" in options).toBe(false);
    expect(desktopPrintSavePdfRequestSchema.shape.options.parse(options)).toEqual(options);
  });

  it("carries the resolved spans, and never invents one for a range that is not settled", () => {
    const options = buildSavePdfOptions({ landscape: false, pageSize: A4, range: { kind: "ranges", ranges: [{ from: 0, to: 2 }, { from: 4, to: 4 }] } });
    expect(options).toEqual({ landscape: false, pageSize: A4, pageRanges: [{ from: 0, to: 2 }, { from: 4, to: 4 }] });
    expect(desktopPrintSavePdfRequestSchema.shape.options.parse(options)).toEqual(options);
    expect("pageRanges" in buildSavePdfOptions({ landscape: false, pageSize: A4, range: { kind: "invalid", reason: "pending" } })).toBe(false);
  });
});
