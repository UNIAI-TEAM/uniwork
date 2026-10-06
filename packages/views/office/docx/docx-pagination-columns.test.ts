// R1 (UNI-823 g3-04d): a section that declares N columns must render N columns.
// The UniWork pagination driver is the App-side loop upstream genoffice owns,
// so the column canvas lives here: the mode/flow decision, the whole-page CSS
// multicol rule plus the single-flow measuring state (uniform), the per-block
// placements (mixed), and the geometry gate that keeps the slicer's `cols` in
// step with the active layout — upstream App.tsx:2949-3022 / 5606-5613.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { parseDocx, readSections, sectionColumns } from "@uniwork/office-upstream/docs-renderer-editor";
import { blocksToDoc } from "./docx-doc-convert";
import { docxExtensions } from "./docx-schema";
import {
  attachDocxPagination,
  colGeomsFor,
  createDocxPaginationSpec,
  docxColumnCss,
  docxColumnFlow,
  docxColumnMode,
} from "./docx-pagination";

const FIXTURES = resolve(__dirname, "../../../../docs/office/g0/fixtures/files/docs");
const COLUMNS_FIXTURE = resolve(FIXTURES, "docx-two-columns.docx");
const SIMPLE_FIXTURE = resolve(FIXTURES, "docx-simple.docx");
const COLUMN_CSS_ID = "uniwork-docx-column-flow";

const section = (columns: number, startType = "nextPage") => ({
  settings: {
    pageWidth: 11906,
    pageHeight: 16838,
    marginTop: 1440,
    marginRight: 1440,
    marginBottom: 1440,
    marginLeft: 1440,
    columns,
  },
  startType,
  firstBlockIndex: 0,
  lastBlockIndex: 1,
});

describe("docxColumnMode / docxColumnFlow / docxColumnCss (R1)", () => {
  it("selects uniform mode for the two-column fixture and emits the canvas column CSS", async () => {
    const parsed = await parseDocx(new Uint8Array(readFileSync(COLUMNS_FIXTURE)));
    const sections = readSections(parsed);
    expect(sections).toHaveLength(1);
    expect(sectionColumns(sections[0]!)).toBe(2);
    expect(docxColumnMode(sections)).toBe("uniform");
    const flow = docxColumnFlow(sections);
    expect(flow?.cols).toBe(2);
    const contentW = twips(11906 - 1440 - 1440);
    expect(flow?.colWidthPx).toBeCloseTo((contentW - (flow?.gapPx ?? 0)) / 2, 5);
    const css = docxColumnCss(sections);
    expect(css).toContain("column-count: 2");
    expect(css).toContain(`column-gap: ${flow?.gapPx}px`);
    expect(css).toContain(".doc-page.measuring-columns");
    // border-box paper: the measuring width is one column plus both margins
    expect(css).toContain(`width: ${(flow?.colWidthPx ?? 0) + twips(1440) * 2}px`);
  });

  it("stays single-flow without column sections and keeps cols only while the layout is active", async () => {
    const parsed = await parseDocx(new Uint8Array(readFileSync(SIMPLE_FIXTURE)));
    const sections = readSections(parsed);
    expect(docxColumnMode(sections)).toBe("none");
    expect(docxColumnFlow(sections)).toBeNull();
    expect(docxColumnCss(sections)).toBe("");

    const geoms = [{ contentHeight: 900, forceBreak: false, cols: 2 }];
    expect(colGeomsFor(geoms, "uniform")).toBe(geoms);
    expect(geoms[0]?.cols).toBe(2);
    expect(colGeomsFor([{ contentHeight: 900, forceBreak: false, cols: 2 }], "none")[0]?.cols).toBeUndefined();
  });

  it("falls back to mixed mode when the sections disagree on the column spec", () => {
    expect(docxColumnMode([section(2), section(2)])).toBe("uniform");
    expect(docxColumnMode([section(2), section(3)])).toBe("mixed");
    expect(docxColumnMode([section(2), section(2, "continuous")])).toBe("mixed");
    expect(docxColumnCss([section(2), section(3)])).toBe("");
  });
});

describe("attachDocxPagination column canvas (R1)", () => {
  it("mounts the colFlow style element for a columned document and clears it on dispose", async () => {
    const parsed = await parseDocx(new Uint8Array(readFileSync(COLUMNS_FIXTURE)));
    const spec = createDocxPaginationSpec(parsed);
    const editor = new Editor({
      extensions: docxExtensions(),
      content: blocksToDoc(parsed.blocks, spec.sections),
      editorProps: { attributes: { class: "doc-page" } },
    });
    const view = render(
      createElement(
        "div",
        { className: "docx-surface" },
        createElement(
          "div",
          { className: "workspace" },
          createElement(
            "div",
            { className: "editor-scroll" },
            createElement(
              "div",
              { className: "doc-zoom view-print" },
              createElement("div", { className: "page-wrap" }, createElement(EditorContent, { editor })),
            ),
          ),
        ),
      ),
    );
    const paginator = attachDocxPagination(editor, spec);
    try {
      paginator.refresh();
      await frames(2);
      const style = document.getElementById(COLUMN_CSS_ID);
      expect(style?.textContent).toContain("column-count: 2");
      expect(document.querySelector(".doc-page")).not.toBeNull();
    } finally {
      paginator.dispose();
      expect(document.getElementById(COLUMN_CSS_ID)).toBeNull();
      view.unmount();
      editor.destroy();
    }
  });
});

function twips(value: number): number {
  return value * (96 / 1440);
}

const frames = (count: number): Promise<void> =>
  new Promise((resolvePromise) => {
    const tick = (remaining: number) => {
      if (remaining <= 0) resolvePromise();
      else requestAnimationFrame(() => tick(remaining - 1));
    };
    tick(count);
  });
