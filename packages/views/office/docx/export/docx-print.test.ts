import type { JSONContent } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import type { DocxHeaderFooterState } from "../header-footer/header-footer-state";
import type { DocxPageSetupSection } from "../page-setup/docx-page-setup";
import { buildDocxPrintHtml, docxPrintCopy, printDocxDocument } from "./docx-print";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function section(overrides: Partial<DocxPageSetupSection> = {}): DocxPageSetupSection {
  return {
    index: 0,
    firstBlockIndex: 0,
    lastBlockIndex: 1,
    pageWidth: 11906,
    pageHeight: 16838,
    orientation: "portrait",
    marginTop: 1440,
    marginRight: 1440,
    marginBottom: 1440,
    marginLeft: 1440,
    columns: 1,
    columnSpace: 720,
    startType: "nextPage",
    ...overrides,
  };
}

function para(text: string, docxIndex: number | null, extra: JSONContent[] = []): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex }, content: [{ type: "text", text }, ...extra] };
}

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function styleText(html: string): string {
  return parse(html).querySelector("style")?.textContent ?? "";
}

function emptyHf(): DocxHeaderFooterState {
  const empty = { value: null, hasImages: false };
  return {
    slots: { header: empty, footer: empty, headerFirst: empty, footerFirst: empty, headerEven: empty, footerEven: empty },
    titlePg: false,
    evenAndOddHeaders: false,
  };
}

describe("buildDocxPrintHtml", () => {
  it("sizes the page from the section: A4 portrait with its margins", () => {
    const css = styleText(buildDocxPrintHtml({ doc: doc(para("One", 0)), title: "Báo cáo", sections: [section()] }));
    expect(css).toContain("@page docx-s0 {\n  size: 595.3pt 841.9pt;\n  margin: 72pt 72pt 72pt 72pt;");
    // The unnamed page carries the first section too, so page 1 never falls back to the UA default.
    expect(css).toContain("@page {\n  size: 595.3pt 841.9pt;");
  });

  it("falls back to A4 with 2.54 cm margins when the document reports no section", () => {
    const css = styleText(buildDocxPrintHtml({ doc: doc(para("One", 0)), title: "x" }));
    expect(css).toContain("size: 595.3pt 841.9pt;");
    expect(css).toContain("margin: 72pt 72pt 72pt 72pt;");
  });

  it("gives a landscape section its own named page and starts it on a new sheet", () => {
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 1 }),
      section({
        index: 1,
        firstBlockIndex: 2,
        lastBlockIndex: 3,
        orientation: "landscape",
        pageWidth: 16838,
        pageHeight: 11906,
        marginTop: 720,
        marginLeft: 1080,
      }),
    ];
    const html = buildDocxPrintHtml({
      doc: doc(para("P1", 0), para("P1 end", 1), para("L1", 2), para("inserted", null), para("L end", 3)),
      title: "x",
      sections,
    });
    const css = styleText(html);
    expect(css).toContain("@page docx-s1 {\n  size: 841.9pt 595.3pt;\n  margin: 36pt 72pt 72pt 54pt;");
    const parts = Array.from(parse(html).querySelectorAll("section.docx-print-section"));
    expect(parts).toHaveLength(2);
    expect(parts[0]?.getAttribute("style")).toBe("page:docx-s0");
    expect(parts[1]?.getAttribute("style")).toBe("page:docx-s1;break-before:page");
    // An editor-created block stays in the section of the block before it.
    expect(parts[1]?.textContent).toBe("L1insertedL end");
    expect(parts[0]?.textContent).toBe("P1P1 end");
  });

  it("maps continuous, odd and even section starts and multi-column sections", () => {
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 0 }),
      section({ index: 1, firstBlockIndex: 1, lastBlockIndex: 1, startType: "continuous", columns: 2, columnSpace: 720 }),
      section({ index: 2, firstBlockIndex: 2, lastBlockIndex: 2, startType: "oddPage" }),
      section({ index: 3, firstBlockIndex: 3, lastBlockIndex: 3, startType: "evenPage" }),
    ];
    const html = buildDocxPrintHtml({ doc: doc(para("a", 0), para("b", 1), para("c", 2), para("d", 3)), title: "x", sections });
    const styles = Array.from(parse(html).querySelectorAll("section")).map((node) => node.getAttribute("style"));
    expect(styles).toEqual([
      "page:docx-s0",
      "page:docx-s1;break-before:auto;column-count:2;column-gap:36pt",
      "page:docx-s2;break-before:right",
      "page:docx-s3;break-before:left",
    ]);
  });

  it("merges a section whose closing break paragraph was deleted into the next one", () => {
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 1 }),
      section({ index: 1, firstBlockIndex: 2, lastBlockIndex: 3, pageWidth: 16838, pageHeight: 11906 }),
    ];
    // Block 1 (section 0's break paragraph) is gone: its content takes section 1's page.
    const html = buildDocxPrintHtml({ doc: doc(para("a", 0), para("c", 2)), title: "x", sections });
    const parts = parse(html).querySelectorAll("section");
    expect(parts).toHaveLength(1);
    expect(styleText(html)).toContain("@page docx-s0 {\n  size: 841.9pt 595.3pt;");
  });

  it("forces a sheet break at a Word page break and keeps page-break-before paragraphs", () => {
    const html = buildDocxPrintHtml({
      doc: doc(
        para("before", 0, [{ type: "hardBreak", attrs: { pageBreak: true } }, { type: "text", text: "after" }]),
        { type: "docParagraph", attrs: { docxIndex: 1, pageBreakBefore: true }, content: [{ type: "text", text: "next" }] },
      ),
      title: "x",
      sections: [section()],
    });
    expect(html).toContain('before<span class="docx-page-break"></span>after');
    expect(html).toContain('<p style="page-break-before:always">next</p>');
    expect(styleText(html)).toContain(".docx-page-break{display:block;break-after:page}");
  });

  it("prints the header and footer through margin boxes with the page number", () => {
    const hf = emptyHf();
    hf.slots.header = { value: { text: 'Công ty "A" </style>' }, hasImages: false };
    hf.slots.footer = { value: { text: "Trang", pageNumber: true }, hasImages: false };
    hf.titlePg = true;
    const css = styleText(buildDocxPrintHtml({ doc: doc(para("x", 0)), title: "x", sections: [section()], headerFooter: hf }));
    expect(css).toContain('@top-center { content: "Công ty \\"A\\" \\3c /style\\3e "; white-space: pre-wrap; font-size: 9pt; }');
    expect(css).toContain('@bottom-center { content: "Trang" " " counter(page);');
    // A first page with an empty first-page variant prints no header there.
    expect(css).toContain("@page :first {\n  @top-center { content: none; }");
    expect(css).not.toContain("@page :left");
  });
});

describe("docxPrintCopy", () => {
  it("is script-free, chrome-free and inlines only data: images", () => {
    const copy = docxPrintCopy({
      doc: doc(
        para("Text", 0, [
          { type: "docInlineImage", attrs: { dataUrl: PNG, widthPx: 10, heightPx: 10 } },
          { type: "docInlineImage", attrs: { dataUrl: "https://tracker.example/pixel.png" } },
          { type: "text", text: "<script>alert(1)</script>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
        ]),
      ),
      title: "Hợp đồng",
      sections: [section()],
    });
    const parsed = parse(copy);
    const images = Array.from(parsed.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(images).toEqual([PNG]);
    expect(copy).not.toContain("tracker.example");
    expect(parsed.querySelector("script")).toBeNull();
    expect(copy).not.toContain("javascript:");
    expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("img-src data:");
    // Document only: nothing of the editor/app chrome reaches the copy, and
    // the first body element is the first section's content (page 1 = content).
    expect(copy).not.toMatch(/data-testid|docx-toolbar|ribbon|status-bar/);
    expect(parsed.body.firstElementChild?.matches("section.docx-print-section")).toBe(true);
    expect(parsed.body.firstElementChild?.textContent?.startsWith("Text")).toBe(true);
    expect(parsed.title).toBe("Hợp đồng");
  });
});

describe("printDocxDocument", () => {
  it("hands the copy and title to the port and returns its outcome", async () => {
    const print = vi.fn(async () => ({ outcome: "printed" as const }));
    const outcome = await printDocxDocument({ port: { print }, title: "Doc", buildCopy: () => "<html></html>" });
    expect(outcome).toEqual({ outcome: "printed" });
    expect(print).toHaveBeenCalledWith({ html: "<html></html>", title: "Doc" });
  });

  it("fails typed when no document is open, without calling the port", async () => {
    const print = vi.fn();
    expect(await printDocxDocument({ port: { print }, title: "Doc", buildCopy: () => null })).toEqual({
      outcome: "failed",
      reason: "no_document",
    });
    expect(print).not.toHaveBeenCalled();
  });

  it("turns a throwing port into a typed failure", async () => {
    const port = {
      print: () => {
        throw new Error("host gone");
      },
    };
    expect(await printDocxDocument({ port, title: "Doc", buildCopy: () => "<html></html>" })).toEqual({
      outcome: "failed",
      reason: "host gone",
    });
  });
});
