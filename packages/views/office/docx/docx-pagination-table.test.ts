// R2 (UNI-823 g3-04d): a table row must not be split across a page break, and
// a w:tblHeader table repeats its header rows on every continuation page
// (G3-D3: docx-long-table rows/cells drifted 61/183 vs the oracle's 65/191).
// The slicer consumes parse-layer metadata (`BlockMeta.tableRowFlags`) and the
// driver turns a cut inside a table into an in-table gap before the next page's
// first row, carrying the grid and the repeated header clones — upstream
// App.tsx:2836-2879 (blockMetaOf), 3704-3763 (table gap), 3894-3912 (row fills).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { buildPaginationFrame, createDocxPaginationSpec, docxBlockMeta, tableCutRow } from "./docx-pagination";

const LONG_TABLE_FIXTURE = resolve(
  __dirname,
  "../../../../docs/office/g0/fixtures/files/docs/docx-long-table.docx",
);

const A4 = {
  pageWidth: 11906,
  pageHeight: 16838,
  marginTop: 1440,
  marginRight: 1440,
  marginBottom: 1440,
  marginLeft: 1440,
};

const liveSection = { settings: { ...A4 }, firstBlockIndex: 0, lastBlockIndex: 6 };

describe("docxBlockMeta (R2)", () => {
  it("maps the fixture's tblHeader table to slicer row flags", async () => {
    const parsed = await parseDocx(new Uint8Array(readFileSync(LONG_TABLE_FIXTURE)));
    const table = parsed.blocks.find((b) => b.type === "table");
    expect(table?.docxIndex).toBe(4);
    const metaOf = docxBlockMeta(parsed);
    const meta = metaOf(table?.docxIndex as number);
    expect(meta?.tableRowFlags).toHaveLength(61);
    // the fixture's sole header row repeats on continuation pages
    expect(meta?.tableRowFlags?.[0]?.isHeader).toBe(true);
    expect(meta?.tableRowFlags?.[1]?.isHeader).toBe(false);
    expect(meta?.tableRowFlags?.at(-1)?.isHeader).toBe(false);
    // compatibilityMode 0: no Word-2013 multirow-header forcing
    expect(meta?.modernTableHeaders).toBeUndefined();
    // a plain heading carries no constraints and costs no lookup repeatedly
    expect(metaOf(0)).toBeUndefined();
    expect(metaOf(0)).toBeUndefined();
  });

  it("carries the block format and the paragraph style's display constraints", () => {
    const styles = new Map([
      ["Normal", { type: "paragraph", isDefault: true, display: { widowControl: false } }],
      ["Heading1", { type: "paragraph", display: { keepNext: true, keepLines: true } }],
    ]);
    const parsed = {
      blocks: [
        { docxIndex: 0, type: "heading", styleId: "Heading1" },
        { docxIndex: 1, type: "paragraph", format: { keepNext: true, pageBreakBefore: true } },
        { docxIndex: 2, type: "paragraph" },
      ],
      styles,
      compatibilityMode: 15,
    };
    const metaOf = docxBlockMeta(parsed);
    expect(metaOf(0)).toEqual({ keepNext: true, keepLines: true });
    expect(metaOf(1)).toEqual({ keepNext: true, breakBefore: true, widowControl: false });
    // the default paragraph style's widowControl:false reaches unstyled blocks
    expect(metaOf(2)).toEqual({ widowControl: false });
    // the table flags carry modernTableHeaders on compat >= 15
    const tableXml =
      '<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>x</w:tc></w:tr>' +
      '<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc>y</w:tc></w:tr></w:tbl>';
    const tableParsed = {
      blocks: [{ docxIndex: 0, type: "table", originalXml: tableXml }],
      styles: new Map(),
      compatibilityMode: 15,
    };
    const tableMeta = docxBlockMeta(tableParsed)(0);
    expect(tableMeta?.tableRowFlags).toEqual([
      { isHeader: true, cantSplit: false },
      { isHeader: false, cantSplit: true },
    ]);
    expect(tableMeta?.modernTableHeaders).toBe(true);
  });

  it("returns undefined for parses without blocks (fake engines)", () => {
    expect(docxBlockMeta({}) (0)).toBeUndefined();
  });
});

describe("tableCutRow (R2)", () => {
  const el = (name: string) => ({ name }) as unknown as Element;
  const rows = [
    { el: el("r0"), top: 0, gapsAbove: 0 },
    { el: el("r1"), top: 40, gapsAbove: 0 },
    { el: el("r2"), top: 80, gapsAbove: 0 },
  ];

  it("names the row that starts the next page when the cut lands on its top", () => {
    const { cutRow, nextRow } = tableCutRow(rows, 80);
    expect(nextRow).toBe(rows[2]?.el);
    expect(cutRow).toBe(rows[1]?.el);
  });

  it("names the row the cut falls inside when no row starts at the cut", () => {
    const { cutRow, nextRow } = tableCutRow(rows, 60);
    expect(nextRow).toBeNull();
    expect(cutRow).toBe(rows[1]?.el);
  });
});

describe("buildPaginationFrame in-table gaps (R2)", () => {
  it("turns a cut inside a table into a table gap with the grid and the header clones", () => {
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    const rows: HTMLTableRowElement[] = [];
    for (let r = 0; r < 3; r += 1) {
      const tr = document.createElement("tr");
      for (let c = 0; c < 2; c += 1) {
        const td = document.createElement("td");
        td.textContent = `r${r}c${c}`;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
      rows.push(tr);
      stubRect(tr, { top: r * 40, height: 40 });
    }
    const spec = createDocxPaginationSpec({ blocks: [], headerText: "", footerText: "" });
    const blocks = [{ top: 0, height: 2000, el: table as unknown as HTMLElement, docxIndex: 4 }];
    const slices = [
      { start: 0, end: 1000, section: 0 },
      { start: 1000, end: 2000, section: 0, repeatHeader: { top: 0, height: 50 } },
    ];
    const view = {
      posAtDOM: () => 0,
      state: {
        doc: {
          resolve: () => ({
            depth: 2,
            before: () => 7,
            node: () => ({ type: { name: "docTableRow" } }),
          }),
        },
      },
    };
    const frame = buildPaginationFrame({
      spec,
      live: [liveSection],
      blocks,
      hfHeights: [{ headerPx: 0, footerPx: 0 }],
      slices,
      view,
    });
    expect(frame.gaps).toHaveLength(1);
    const gap = frame.gaps[0];
    expect(gap?.kind).toBe("table");
    expect(gap?.pos).toBe(7);
    expect(gap?.cols).toBe(2);
    // the two source rows (40px each) cover the reserved 50px
    expect(gap?.repeatHeaderEls?.map((el) => el.textContent)).toEqual(["r0c0r0c1", "r1c0r1c1"]);
    for (const clone of gap?.repeatHeaderEls ?? []) {
      expect(clone.classList.contains("page-repeat-header")).toBe(true);
      expect(clone.classList.contains("page-gap-inline")).toBe(true);
      expect(clone.getAttribute("contenteditable")).toBe("false");
    }
    expect(gap?.repeatHeaderKey).toContain("2-50-");
    // the gap carries no repeated-header clones when the slicer reserved none
    const noReserve = buildPaginationFrame({
      spec,
      live: [liveSection],
      blocks,
      hfHeights: [{ headerPx: 0, footerPx: 0 }],
      slices: [{ start: 0, end: 1000, section: 0 }, { start: 1000, end: 2000, section: 0 }],
      view,
    });
    expect(noReserve.gaps[0]?.kind).toBe("table");
    expect(noReserve.gaps[0]?.repeatHeaderEls).toBeUndefined();
    expect(rows).toHaveLength(3);
  });
});

function stubRect(el: Element, rect: { top: number; height: number }): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: rect.top,
      top: rect.top,
      left: 0,
      right: 600,
      bottom: rect.top + rect.height,
      width: 600,
      height: rect.height,
      toJSON: () => ({}),
    }),
  });
}
