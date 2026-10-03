import { describe, expect, it } from "vitest";
import {
  DOCX_HF_SLOTS,
  clearHeaderFooterEdit,
  emptyHeaderFooterState,
  hasHfSlotContent,
  headerFooterKindOf,
  readDocxHeaderFooterState,
  setEvenOddHeadersEdit,
  setHeaderFooterEdit,
  setTitlePgEdit,
} from "./header-footer-state";

describe("readDocxHeaderFooterState", () => {
  it("returns the empty state for an absent parse", () => {
    const state = readDocxHeaderFooterState(null);
    expect(state).toEqual(emptyHeaderFooterState());
    expect(state.slots.header.value).toBeNull();
  });

  it("maps the default header/footer document fields", () => {
    const paras = [{ align: "center", runs: [{ text: "Page" }] }];
    const state = readDocxHeaderFooterState({
      headerText: "Confidential",
      headerHasPageNumber: true,
      footerParas: paras,
      headerImages: [{ dataUrl: "data:image/png;base64,x" }],
    });
    expect(state.slots.header.value).toEqual({ text: "Confidential", pageNumber: true });
    expect(state.slots.header.hasImages).toBe(true);
    expect(state.slots.footer.value).toEqual({ text: "", paras });
    expect(state.slots.footer.hasImages).toBe(false);
    expect(state.slots.headerFirst.value).toBeNull();
  });

  it("treats whitespace-only text without fields, paragraphs or images as no content", () => {
    const state = readDocxHeaderFooterState({ headerText: "   ", footerParas: [], footerImages: [] });
    expect(state.slots.header.value).toBeNull();
    expect(state.slots.footer.value).toBeNull();
    expect(state.slots.footer.hasImages).toBe(false);
  });

  it("maps the first/even parts and their images", () => {
    const state = readDocxHeaderFooterState({
      headerFirst: { text: "", hasPageNumber: true, paras: [], images: [] },
      footerFirst: { text: "Cover footer", hasPageNumber: false, paras: [], images: [] },
      headerEven: { text: "", hasPageNumber: false, paras: [{ runs: [{ text: "Even" }] }], images: [] },
      footerEven: { text: "", hasPageNumber: false, paras: [], images: [{ dataUrl: "x" }] },
    });
    expect(state.slots.headerFirst.value).toEqual({ text: "", pageNumber: true });
    expect(state.slots.footerFirst.value).toEqual({ text: "Cover footer" });
    expect(state.slots.headerEven.value).toEqual({ text: "", paras: [{ runs: [{ text: "Even" }] }] });
    expect(state.slots.footerEven.value).toBeNull();
    expect(state.slots.footerEven.hasImages).toBe(true);
  });

  it("reads the two variant flags from the document settings", () => {
    expect(readDocxHeaderFooterState({ titlePg: true, evenAndOddHeaders: true })).toMatchObject({
      titlePg: true,
      evenAndOddHeaders: true,
    });
    expect(readDocxHeaderFooterState({})).toMatchObject({ titlePg: false, evenAndOddHeaders: false });
  });

  it("lists every model slot exactly once", () => {
    expect([...DOCX_HF_SLOTS]).toEqual(["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"]);
    expect(new Set(DOCX_HF_SLOTS).size).toBe(6);
  });
});

describe("slot helpers", () => {
  it("counts an image-only slot as content", () => {
    expect(hasHfSlotContent({ value: null, hasImages: true })).toBe(true);
    expect(hasHfSlotContent({ value: null, hasImages: false })).toBe(false);
    expect(hasHfSlotContent({ value: { text: "" }, hasImages: false })).toBe(true);
  });

  it("classifies slots by side of the page", () => {
    expect(headerFooterKindOf("header")).toBe("header");
    expect(headerFooterKindOf("headerFirst")).toBe("header");
    expect(headerFooterKindOf("headerEven")).toBe("header");
    expect(headerFooterKindOf("footer")).toBe("footer");
    expect(headerFooterKindOf("footerFirst")).toBe("footer");
    expect(headerFooterKindOf("footerEven")).toBe("footer");
  });
});

describe("edit builders", () => {
  it("builds the existing set_header_footer edit for a value and for a clear", () => {
    expect(setHeaderFooterEdit("footerEven", { text: "Draft" })).toEqual({
      op: "set_header_footer",
      slot: "footerEven",
      hf: { text: "Draft" },
    });
    expect(setHeaderFooterEdit("header", null)).toEqual({ op: "set_header_footer", slot: "header", hf: null });
    expect(clearHeaderFooterEdit("headerFirst")).toEqual({
      op: "set_header_footer",
      slot: "headerFirst",
      hf: { text: "" },
    });
  });

  it("builds the two variant-flag edits", () => {
    expect(setTitlePgEdit(true)).toEqual({ op: "set_title_pg", value: true });
    expect(setTitlePgEdit(false)).toEqual({ op: "set_title_pg", value: false });
    expect(setEvenOddHeadersEdit(true)).toEqual({ op: "set_even_odd_headers", value: true });
    expect(setEvenOddHeadersEdit(false)).toEqual({ op: "set_even_odd_headers", value: false });
  });
});
