import { describe, expect, it } from "vitest";
import {
  boundedInt,
  buildPageSetupFields,
  initialPageSetupForm,
  printTitlesSpan,
  selectionPrintArea,
  type XlsxPageSetupFormState,
} from "./page-setup-form";

const form = (patch: Partial<XlsxPageSetupFormState>): XlsxPageSetupFormState => ({ ...initialPageSetupForm(), ...patch });

describe("boundedInt", () => {
  it("reads empty as keep, whole numbers in range, and rejects the rest", () => {
    expect(boundedInt("", 10, 400)).toBeNull();
    expect(boundedInt("  ", 10, 400)).toBeNull();
    expect(boundedInt("75", 10, 400)).toBe(75);
    expect(boundedInt("9", 10, 400)).toBe("invalid");
    expect(boundedInt("401", 10, 400)).toBe("invalid");
    expect(boundedInt("1.5", 0, 1_000)).toBe("invalid");
    expect(boundedInt("-1", 0, 1_000)).toBe("invalid");
    expect(boundedInt("abc", 0, 1_000)).toBe("invalid");
  });
});

describe("selectionPrintArea", () => {
  it("spans a selection in A1 form and collapses a single cell", () => {
    expect(selectionPrintArea({ sheet: "Data", address: "A1", endAddress: "C10" })).toBe("A1:C10");
    expect(selectionPrintArea({ sheet: "Data", address: "B2" })).toBe("B2");
    expect(selectionPrintArea({ sheet: "Data", address: "C10", endAddress: "A1" })).toBe("A1:C10");
    expect(selectionPrintArea(null)).toBeNull();
  });
});

describe("printTitlesSpan", () => {
  it("accepts a row span only", () => {
    expect(printTitlesSpan("1:2")).toBe("1:2");
    expect(printTitlesSpan(" 1:2 ")).toBe("1:2");
    expect(printTitlesSpan("1:1048576")).toBe("1:1048576");
    expect(printTitlesSpan("")).toBeNull();
    expect(printTitlesSpan("A1:B2")).toBeNull();
    expect(printTitlesSpan("3:1")).toBeNull();
  });

  it("refuses the spans the engine's grammar refuses", () => {
    // start >= 1 and end <= 1_048_576, so the dialog shows invalidTitles
    // instead of letting a raw XlsxOpError surface after Apply.
    expect(printTitlesSpan("0:5")).toBeNull();
    expect(printTitlesSpan("1:2000000")).toBeNull();
    expect(printTitlesSpan("0:0")).toBeNull();
  });
});

describe("buildPageSetupFields", () => {
  it("keeps only the fields the user changed", () => {
    const built = buildPageSetupFields(form({ orientation: "landscape", margins: "narrow", paperSize: 9, scale: "75" }), null);
    expect(built).toEqual({ ok: true, fields: { orientation: "landscape", margins: "narrow", paperSize: 9, scale: 75 } });
  });

  it("refuses an all-keep form", () => {
    expect(buildPageSetupFields(initialPageSetupForm(), null)).toEqual({ ok: false, error: "empty" });
  });

  it("maps the tri-state booleans and the fit fields", () => {
    const built = buildPageSetupFields(form({ fitToPage: "on", fitToWidth: "1", fitToHeight: "0", printGridlines: "on", printHeadings: "off" }), null);
    expect(built).toEqual({ ok: true, fields: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, printGridlines: true, printHeadings: false } });
  });

  it("sets the print area from the selection and clears it with null", () => {
    const set = buildPageSetupFields(form({ printArea: "selection" }), { sheet: "Data", address: "A1", endAddress: "C10" });
    expect(set).toEqual({ ok: true, fields: { printArea: "A1:C10" } });
    expect(buildPageSetupFields(form({ printArea: "selection" }), null)).toEqual({ ok: false, error: "printArea" });
    expect(buildPageSetupFields(form({ printArea: "clear" }), null)).toEqual({ ok: true, fields: { printArea: null } });
  });

  it("sets and clears print titles", () => {
    expect(buildPageSetupFields(form({ printTitles: "1:2" }), null)).toEqual({ ok: true, fields: { printTitles: "1:2" } });
    expect(buildPageSetupFields(form({ printTitles: "x" }), null)).toEqual({ ok: false, error: "printTitles" });
    expect(buildPageSetupFields(form({ printTitlesClear: true }), null)).toEqual({ ok: true, fields: { printTitles: null } });
  });

  it("refuses an out-of-range number", () => {
    expect(buildPageSetupFields(form({ scale: "9" }), null)).toEqual({ ok: false, error: "scale" });
    expect(buildPageSetupFields(form({ fitToWidth: "1001" }), null)).toEqual({ ok: false, error: "fit" });
    expect(buildPageSetupFields(form({ frozenRows: "-1" }), null)).toEqual({ ok: false, error: "frozen" });
  });

  it("requires the frozen pane as a pair so a lone axis cannot zero the other", () => {
    expect(buildPageSetupFields(form({ frozenRows: "2" }), null)).toEqual({ ok: false, error: "frozenPair" });
    expect(buildPageSetupFields(form({ frozenColumns: "1" }), null)).toEqual({ ok: false, error: "frozenPair" });
    expect(buildPageSetupFields(form({ frozenRows: "2", frozenColumns: "0" }), null)).toEqual({
      ok: true,
      fields: { frozenRows: 2, frozenColumns: 0 },
    });
  });
});
