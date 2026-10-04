// B6 view-model tests: the display mirror of pending ops, the dialog's draft
// seeding and the minimal-op diff (including refusals) behind Apply.
import { describe, expect, it } from "vitest";
import type { DocxParsed } from "@uniwork/office-engine/docx";
import type { Editor } from "@tiptap/core";
import {
  activeDecorSectionIndex,
  applyDecorEditToView,
  cloneDecorView,
  decorDraftFromView,
  decorViewFromParsed,
  editsFromDraft,
  normalizeHex,
  type DocxPageDecorSection,
  type DocxPageDecorView,
} from "./docx-page-decor";

const P = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const SECT_PR = (extra = "") =>
  `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>${extra}</w:sectPr>`;

/** Two sections: block 1 closes section 0, the hidden block closes section 1. */
function parsedFixture(): DocxParsed {
  return {
    blocks: [
      { type: "paragraph", docxIndex: 0, originalXml: P("first") },
      { type: "paragraph", docxIndex: 1, originalXml: `<w:p><w:pPr>${SECT_PR()}</w:pPr></w:p>` },
      { type: "paragraph", docxIndex: 2, originalXml: P("second") },
      {
        type: "sectPr",
        docxIndex: 3,
        hidden: true,
        originalXml: SECT_PR('<w:pgBorders w:offsetFrom="page"><w:top w:val="double" w:sz="8" w:space="16" w:color="44546A"/></w:pgBorders>'),
      },
    ],
    watermarkText: "DRAFT",
    watermarkPicture: null,
    themeFonts: { major: "Trebuchet MS", minor: "Trebuchet MS" },
    themeColors: { accent1: "90C226" },
    internal: { documentXml: '<w:document><w:background w:color="e8f1fb"/></w:document>' },
  };
}

function fixtureView(): DocxPageDecorView {
  return {
    pageColor: "E8F1FB",
    watermarkText: "DRAFT",
    hasPictureWatermark: false,
    themeFonts: { major: "Trebuchet MS", minor: "Trebuchet MS" },
    themeColors: { accent1: "90C226" },
    sections: [
      { index: 0, firstBlockIndex: 0, lastBlockIndex: 1, borders: null },
      {
        index: 1,
        firstBlockIndex: 2,
        lastBlockIndex: 3,
        borders: { style: "double", widthEighths: 8, spacePt: 16, colorHex: "44546A", offsetFrom: "page" },
      },
    ],
    activeIndex: 1,
  };
}

/** A minimal Editor stand-in: the model only reads the doc's top-level blocks
 * and the selection position. */
function fakeEditor(attrs: Array<Record<string, unknown>>, from = 0): Editor {
  return {
    isDestroyed: false,
    state: {
      selection: { from },
      doc: {
        childCount: attrs.length,
        content: { size: attrs.length * 2 },
        child: (index: number) => ({ attrs: attrs[index], nodeSize: 2 }),
        resolve: () => ({ index: () => 0 }),
      },
    },
  } as unknown as Editor;
}

describe("decorViewFromParsed", () => {
  it("reads colour, watermark, theme and per-section boxes from the parse", () => {
    const view = decorViewFromParsed(parsedFixture());
    expect(view).not.toBeNull();
    expect(view?.pageColor).toBe("E8F1FB");
    expect(view?.watermarkText).toBe("DRAFT");
    expect(view?.hasPictureWatermark).toBe(false);
    expect(view?.themeFonts).toEqual({ major: "Trebuchet MS", minor: "Trebuchet MS" });
    expect(view?.themeColors).toEqual({ accent1: "90C226" });
    expect(view?.sections[0]!.borders).toBeNull();
    expect(view?.sections[1]!.borders).toEqual({ style: "double", widthEighths: 8, spacePt: 16, colorHex: "44546A", offsetFrom: "page" });
    expect(decorViewFromParsed(null)).toBeNull();
    expect(decorViewFromParsed({})).toBeNull();
  });

  it("mirrors every op onto a display copy without touching the source", () => {
    const view = fixtureView();
    const next = applyDecorEditToView(view, { op: "set_page_color", color: "FFF9E6" });
    expect(next.pageColor).toBe("FFF9E6");
    expect(view.pageColor).toBe("E8F1FB");

    const removed = applyDecorEditToView(next, { op: "set_watermark", watermark: null });
    expect(removed.watermarkText).toBeNull();
    const set = applyDecorEditToView(removed, { op: "set_watermark", watermark: { text: "CONFIDENTIAL" } });
    expect(set.watermarkText).toBe("CONFIDENTIAL");
    expect(set.hasPictureWatermark).toBe(false);

    const themed = applyDecorEditToView(set, { op: "set_theme_fonts", fonts: { major: "Arial", minor: "Arial" } });
    expect(themed.themeFonts).toEqual({ major: "Arial", minor: "Arial" });
    const colored = applyDecorEditToView(themed, { op: "set_theme_colors", colors: { accent2: "ED7D31" } });
    expect(colored.themeColors).toEqual({ accent1: "90C226", accent2: "ED7D31" });

    const bordered = applyDecorEditToView(colored, { op: "set_page_borders", sectionIndex: 0, borders: { style: "single" } });
    expect(bordered.sections[0]!.borders).toEqual({ style: "single" });
    const cleared = applyDecorEditToView(bordered, { op: "set_page_borders", sectionIndex: 1, borders: null });
    expect(cleared.sections[1]!.borders).toBeNull();
    expect(cloneDecorView(view)).toEqual(view);
    expect(cloneDecorView(view)).not.toBe(view);
  });
});

describe("activeDecorSectionIndex", () => {
  const sections: DocxPageDecorSection[] = fixtureView().sections;

  it("maps the caret's block to its section and falls back to the nearest", () => {
    expect(activeDecorSectionIndex(null, sections)).toBe(0);
    expect(activeDecorSectionIndex(fakeEditor([{ docxIndex: 0 }]), sections)).toBe(0);
    expect(activeDecorSectionIndex(fakeEditor([{ docxIndex: 2 }]), sections)).toBe(1);
    expect(activeDecorSectionIndex(fakeEditor([{ docxIndex: null }, { docxIndex: 9 }]), sections)).toBe(1);
  });
});

describe("editsFromDraft", () => {
  it("returns nothing for an untouched draft", () => {
    const view = fixtureView();
    const draft = decorDraftFromView(view);
    expect(editsFromDraft(draft, draft, view)).toEqual({ edits: [], error: null });
  });

  it("targets the active section and emits the border box once enabled", () => {
    const view = fixtureView();
    const initial = decorDraftFromView(view);
    const draft = { ...initial, borderOn: true, borderStyle: "wave", borderWidth: "12", borderOffset: "text" as const };
    const { edits, error } = editsFromDraft(draft, initial, view);
    expect(error).toBeNull();
    expect(edits).toEqual([
      { op: "set_page_borders", sectionIndex: 1, borders: { style: "wave", widthEighths: 12, spacePt: 16, offsetFrom: "text", colorHex: "44546A" } },
    ]);
    const off = editsFromDraft({ ...initial, borderOn: false }, initial, view);
    expect(off.edits).toEqual([{ op: "set_page_borders", sectionIndex: 1, borders: null }]);
    // a draft seeded on the earlier section targets it (no box -> default box)
    const firstView = { ...view, activeIndex: 0 };
    const firstInitial = decorDraftFromView(firstView);
    const first = editsFromDraft({ ...firstInitial, borderOn: true }, firstInitial, firstView);
    expect(first.edits).toEqual([
      { op: "set_page_borders", sectionIndex: 0, borders: { style: "single", widthEighths: 4, spacePt: 24, offsetFrom: "page" } },
    ]);
  });

  it("emits a normalized watermark spec only when the text or style changed", () => {
    const view = fixtureView();
    const initial = decorDraftFromView(view);
    const set = editsFromDraft({ ...initial, watermarkText: "  CONFIDENTIAL  ", watermarkFont: "Arial", watermarkColor: "#ab12cd", watermarkOpacity: "75", watermarkDiagonal: false }, initial, view);
    expect(set).toEqual({
      edits: [{ op: "set_watermark", watermark: { text: "CONFIDENTIAL", fontFamily: "Arial", colorHex: "AB12CD", opacity: 0.75, diagonal: false } }],
      error: null,
    });
    const removed = editsFromDraft({ ...initial, watermarkText: "", watermarkRemoved: true }, initial, view);
    expect(removed.edits).toEqual([{ op: "set_watermark", watermark: null }]);
    // clearing the field of an existing watermark also removes it
    expect(editsFromDraft({ ...initial, watermarkText: "" }, initial, view).edits).toEqual([{ op: "set_watermark", watermark: null }]);
  });

  it("emits the page colour and the changed theme slots", () => {
    const view = fixtureView();
    const initial = decorDraftFromView(view);
    const colored = editsFromDraft({ ...initial, pageColor: "fff9e6" }, initial, view);
    expect(colored).toEqual({ edits: [{ op: "set_page_color", color: "FFF9E6" }], error: null });
    const cleared = editsFromDraft({ ...initial, pageColor: "" }, initial, view);
    expect(cleared.edits).toEqual([{ op: "set_page_color", color: null }]);
    const theme = editsFromDraft(
      { ...initial, themeMajor: "Arial", themeMinor: "Arial", themeEastAsia: "", themeColors: { ...initial.themeColors, accent1: "AABBCC", accent2: "112233" } },
      initial,
      view,
    );
    expect(theme.edits).toEqual([
      { op: "set_theme_fonts", fonts: { major: "Arial", minor: "Arial" } },
      { op: "set_theme_colors", colors: { accent1: "AABBCC", accent2: "112233" } },
    ]);
  });

  it("refuses invalid drafts with a typed error key and no ops", () => {
    const view = fixtureView();
    const initial = decorDraftFromView(view);
    expect(editsFromDraft({ ...initial, pageColor: "nope" }, initial, view)).toEqual({ edits: [], error: "invalidColor" });
    expect(editsFromDraft({ ...initial, watermarkText: "X", watermarkColor: "nope" }, initial, view)).toEqual({ edits: [], error: "invalidColor" });
    expect(editsFromDraft({ ...initial, watermarkText: "X", watermarkOpacity: "0" }, initial, view)).toEqual({ edits: [], error: "invalidOpacity" });
    expect(editsFromDraft({ ...initial, borderOn: true, borderWidth: "3" }, initial, view)).toEqual({ edits: [], error: "invalidBorderSize" });
    expect(editsFromDraft({ ...initial, borderOn: true, borderSpace: "99" }, initial, view)).toEqual({ edits: [], error: "invalidBorderSpace" });
    expect(editsFromDraft({ ...initial, themeMajor: " " }, initial, view)).toEqual({ edits: [], error: "emptyThemeFont" });
    expect(editsFromDraft({ ...initial, themeColors: { ...initial.themeColors, accent1: "zzz" } }, initial, view)).toEqual({ edits: [], error: "invalidThemeColor" });
  });
});

describe("normalizeHex", () => {
  it("accepts #-prefixed and bare hex, rejects everything else", () => {
    expect(normalizeHex("#fff9e6")).toBe("FFF9E6");
    expect(normalizeHex("fff9e6")).toBe("FFF9E6");
    expect(normalizeHex("yellow")).toBeNull();
    expect(normalizeHex("#FFF")).toBeNull();
  });
});
