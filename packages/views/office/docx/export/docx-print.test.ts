import type { JSONContent } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import type { DocxPageSetupSection } from "../page-setup/docx-page-setup";
import type { OfficePrintRequest } from "../../print";
import { buildDocxPrintHtml, docxPrintCopy, printDocxDocument } from "./docx-print";
import type { DocxPrintHeaderFooter, DocxPrintSectionHf } from "./docx-print-header-footer";

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

type HfPart = NonNullable<DocxPrintSectionHf["header"]["default"]>;

function hfPart(id: string, overrides: Partial<HfPart> = {}): HfPart {
  return { id, text: id, pageNumber: false, images: [], ...overrides };
}

function sectionHf(index: number, overrides: Partial<DocxPrintSectionHf> = {}): DocxPrintSectionHf {
  return {
    index,
    titlePg: false,
    header: { default: null, first: null, even: null },
    footer: { default: null, first: null, even: null },
    ...overrides,
  };
}

function pageNames(html: string): (string | undefined)[] {
  return Array.from(parse(html).querySelectorAll("section")).map((node) => /page:([\w-]+)/.exec(node.getAttribute("style") ?? "")?.[1]);
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
    // Same geometry throughout: one named page, so only the start type decides the breaks.
    expect(styles).toEqual([
      "page:docx-s0",
      "page:docx-s0;break-before:auto;column-count:2;column-gap:36pt",
      "page:docx-s0;break-before:right",
      "page:docx-s0;break-before:left",
    ]);
  });

  it("keeps a continuous section of the same geometry on the previous section's named page", () => {
    // A differing `page` value forces a sheet break in a real engine, so a continuous
    // two-column section only flows on when it shares the page name of the section before it.
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 0 }),
      section({ index: 1, firstBlockIndex: 1, lastBlockIndex: 1, startType: "continuous", columns: 2 }),
    ];
    const html = buildDocxPrintHtml({ doc: doc(para("a", 0), para("b", 1)), title: "x", sections });
    const names = Array.from(parse(html).querySelectorAll("section")).map((node) => /page:([\w-]+)/.exec(node.getAttribute("style") ?? "")?.[1]);
    expect(names).toEqual(["docx-s0", "docx-s0"]);
    expect(styleText(html).match(/@page docx-s\d+ \{/g)).toEqual(["@page docx-s0 {"]);
  });

  it("gives a continuous section with a different size its own named page", () => {
    // The break is unavoidable (Word starts a new sheet for a size change too).
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 0 }),
      section({ index: 1, firstBlockIndex: 1, lastBlockIndex: 1, startType: "continuous", pageWidth: 12240, pageHeight: 15840 }),
      section({ index: 2, firstBlockIndex: 2, lastBlockIndex: 2, startType: "continuous", marginLeft: 720 }),
    ];
    const html = buildDocxPrintHtml({ doc: doc(para("a", 0), para("b", 1), para("c", 2)), title: "x", sections });
    const names = Array.from(parse(html).querySelectorAll("section")).map((node) => /page:([\w-]+)/.exec(node.getAttribute("style") ?? "")?.[1]);
    expect(names).toEqual(["docx-s0", "docx-s1", "docx-s2"]);
    expect(styleText(html)).toContain("@page docx-s1 {\n  size: 612pt 792pt;");
  });

  it("reuses a page name when the geometry comes back after another section", () => {
    const landscape = { pageWidth: 16838, pageHeight: 11906 };
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 0 }),
      section({ index: 1, firstBlockIndex: 1, lastBlockIndex: 1, ...landscape }),
      section({ index: 2, firstBlockIndex: 2, lastBlockIndex: 2 }),
    ];
    const html = buildDocxPrintHtml({ doc: doc(para("a", 0), para("b", 1), para("c", 2)), title: "x", sections });
    const names = Array.from(parse(html).querySelectorAll("section")).map((node) => /page:([\w-]+)/.exec(node.getAttribute("style") ?? "")?.[1]);
    expect(names).toEqual(["docx-s0", "docx-s1", "docx-s0"]);
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
    const headerFooter: DocxPrintHeaderFooter = {
      evenAndOddHeaders: false,
      sections: [
        sectionHf(0, {
          titlePg: true,
          header: { default: hfPart("h", { text: 'Công ty "A" </style>' }), first: null, even: null },
          footer: { default: hfPart("f", { text: "Trang", pageNumber: true }), first: null, even: null },
        }),
      ],
    };
    const css = styleText(buildDocxPrintHtml({ doc: doc(para("x", 0)), title: "x", sections: [section()], headerFooter }));
    expect(css).toContain('@page docx-s0 {\n  @top-center { content: "Công ty \\"A\\" \\3c /style\\3e "; white-space: pre-wrap; font-size: 9pt; }');
    expect(css).toContain('@bottom-center { content: "Trang" " " counter(page);');
    // A first page with an empty first-page variant prints no header there.
    expect(css).toContain("@page docx-s0:first {\n  @top-left { content: none; }\n  @top-center { content: none; }");
    expect(css).not.toContain(":left");
  });

  it("gives a section that starts a sheet with its own header a new page name, and only the first page name a :first rule", () => {
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 0 }),
      section({ index: 1, firstBlockIndex: 1, lastBlockIndex: 1, startType: "continuous" }),
      section({ index: 2, firstBlockIndex: 2, lastBlockIndex: 2 }),
      section({ index: 3, firstBlockIndex: 3, lastBlockIndex: 3 }),
    ];
    const chapter = (text: string) => ({ default: hfPart(text), first: hfPart(`${text}-first`), even: null });
    const headerFooter: DocxPrintHeaderFooter = {
      evenAndOddHeaders: false,
      sections: [
        sectionHf(0, { titlePg: true, header: chapter("Chương 1") }),
        // Same printed parts (the first-page part cannot print past page 1): flows on.
        sectionHf(1, { header: { default: hfPart("Chương 1"), first: null, even: null } }),
        // A next-page section with another header: its own page name.
        sectionHf(2, { titlePg: true, header: chapter("Chương 2") }),
        // The same parts as section 0 under another relationship id: the same page name again.
        sectionHf(3, { header: { default: hfPart("rId-other", { text: "Chương 1" }), first: null, even: null } }),
      ],
    };
    const html = buildDocxPrintHtml({ doc: doc(para("a", 0), para("b", 1), para("c", 2), para("d", 3)), title: "x", sections, headerFooter });
    expect(pageNames(html)).toEqual(["docx-s0", "docx-s0", "docx-s1", "docx-s0"]);
    const css = styleText(html);
    expect(css).toContain('@page docx-s1 {\n  @top-center { content: "Chương 2";');
    expect(css.match(/@page [\w-]+:first/g)).toEqual(["@page docx-s0:first"]);
    expect(css).toContain('@page docx-s0:first {\n  @top-left { content: none; }\n  @top-center { content: "Chương 1-first";');
  });

  it("lets a continuous section with another header flow on without a sheet break, as Word does", () => {
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 0 }),
      section({ index: 1, firstBlockIndex: 1, lastBlockIndex: 1, startType: "continuous" }),
      section({ index: 2, firstBlockIndex: 2, lastBlockIndex: 2, startType: "continuous", pageWidth: 16838, pageHeight: 11906 }),
      section({ index: 3, firstBlockIndex: 3, lastBlockIndex: 3, startType: "continuous", pageWidth: 16838, pageHeight: 11906 }),
    ];
    const header = (text: string) => ({ default: hfPart(text), first: null, even: null });
    const headerFooter: DocxPrintHeaderFooter = {
      evenAndOddHeaders: false,
      sections: [
        sectionHf(0, { header: header("Chương 1") }),
        sectionHf(1, { header: header("Chương 2") }),
        sectionHf(2, { header: header("Chương 3") }),
        sectionHf(3, { header: header("Chương 4") }),
      ],
    };
    const html = buildDocxPrintHtml({ doc: doc(para("a", 0), para("b", 1), para("c", 2), para("d", 3)), title: "x", sections, headerFooter });
    // Section 1 keeps the previous sheet and its header. Section 2 changes the paper, which does break; section 3 flows on with it.
    expect(pageNames(html)).toEqual(["docx-s0", "docx-s0", "docx-s1", "docx-s1"]);
    const css = styleText(html);
    expect(css.match(/@page docx-s\d+ \{\n {2}@top-center/g)).toEqual(["@page docx-s0 {\n  @top-center", "@page docx-s1 {\n  @top-center"]);
    expect(css).toContain('@top-center { content: "Chương 1";');
    expect(css).toContain('@top-center { content: "Chương 3";');
    expect(css).not.toContain("Chương 2");
    expect(css).not.toContain("Chương 4");
  });

  it("prints each section's even parts on its own :left pages", () => {
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 0 }),
      section({ index: 1, firstBlockIndex: 1, lastBlockIndex: 1 }),
    ];
    const headerFooter: DocxPrintHeaderFooter = {
      evenAndOddHeaders: true,
      sections: [
        sectionHf(0, { header: { default: hfPart("Lẻ"), first: null, even: hfPart("Chẵn") } }),
        sectionHf(1, { header: { default: hfPart("Lẻ"), first: null, even: hfPart("Chẵn 2") } }),
      ],
    };
    const css = styleText(buildDocxPrintHtml({ doc: doc(para("a", 0), para("b", 1)), title: "x", sections, headerFooter }));
    expect(css).toContain('@page docx-s0:left {\n  @top-left { content: none; }\n  @top-center { content: "Chẵn";');
    expect(css).toContain('@page docx-s1:left {\n  @top-left { content: none; }\n  @top-center { content: "Chẵn 2";');
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

  it("keeps a header picture as a data: URL in the sanitized copy", () => {
    const headerFooter: DocxPrintHeaderFooter = {
      evenAndOddHeaders: false,
      sections: [sectionHf(0, { header: { default: hfPart("logo", { text: "", images: [{ dataUrl: PNG, align: "center" }] }), first: null, even: null } })],
    };
    const copy = docxPrintCopy({ doc: doc(para("Text", 0)), title: "x", sections: [section()], headerFooter });
    // The picture is defined once on :root and the margin box names it.
    expect(styleText(copy)).toContain(`:root {\n  --docx-hf-img-0: url("${PNG}");\n}`);
    expect(styleText(copy)).toContain("@top-center { content: var(--docx-hf-img-0);");
  });

  it("carries a header picture once however many named pages and variants print it", () => {
    const sections = [
      section({ index: 0, firstBlockIndex: 0, lastBlockIndex: 0 }),
      section({ index: 1, firstBlockIndex: 1, lastBlockIndex: 1, pageWidth: 16838, pageHeight: 11906 }),
    ];
    const logo = hfPart("logo", { text: "", images: [{ dataUrl: PNG, align: "left" }] });
    const headerFooter: DocxPrintHeaderFooter = {
      evenAndOddHeaders: true,
      sections: [
        sectionHf(0, { titlePg: true, header: { default: logo, first: logo, even: logo }, footer: { default: logo, first: null, even: null } }),
        sectionHf(1, { header: { default: logo, first: null, even: logo }, footer: { default: null, first: null, even: null } }),
      ],
    };
    const copy = docxPrintCopy({ doc: doc(para("a", 0), para("b", 1)), title: "x", sections, headerFooter });
    expect(copy.split(PNG)).toHaveLength(2);
    expect(styleText(copy).match(/var\(--docx-hf-img-0\)/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("scales a header picture to the section's own top margin", () => {
    const png = (height: number): string => {
      const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
      const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, ...be32(300), ...be32(height), 8, 2, 0, 0, 0];
      return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    };
    // A 0.5 inch (48 px) top margin and a 192 px tall logo shown at its natural size: a quarter size.
    const headerFooter: DocxPrintHeaderFooter = {
      evenAndOddHeaders: false,
      sections: [sectionHf(0, { header: { default: hfPart("logo", { text: "", images: [{ dataUrl: png(192), align: "left" }] }), first: null, even: null } })],
    };
    const css = styleText(buildDocxPrintHtml({ doc: doc(para("a", 0)), title: "x", sections: [section({ marginTop: 720 })], headerFooter }));
    expect(css).toContain("@top-left { content: image-set(var(--docx-hf-img-0) 4x);");
    const roomy = styleText(buildDocxPrintHtml({ doc: doc(para("a", 0)), title: "x", sections: [section({ marginTop: 2880 })], headerFooter }));
    expect(roomy).toContain("@top-left { content: var(--docx-hf-img-0);");
  });
});

describe("printDocxDocument", () => {
  it("hands the copy and title to the port and returns its outcome", async () => {
    const print = vi.fn(async () => ({ outcome: "printed" as const }));
    const outcome = await printDocxDocument({ port: { print }, title: "Doc", buildCopy: () => "<html></html>" });
    expect(outcome).toEqual({ outcome: "printed" });
    expect(print).toHaveBeenCalledWith({ html: "<html></html>", title: "Doc" });
  });

  it("tells the port the first section's page as printed, the size its @page lays out", async () => {
    const print = vi.fn(async (_request: OfficePrintRequest) => ({ outcome: "printed" as const }));
    const landscape = section({ orientation: "landscape", pageWidth: 16838, pageHeight: 11906 });
    await printDocxDocument({ port: { print }, title: "Doc", buildCopy: () => docxPrintCopy({ doc: doc(para("a", 0)), title: "Doc", sections: [landscape] }) });
    const page = print.mock.calls[0]![0].page!;
    expect(page.landscape).toBe(true);
    expect(page.widthMm).toBeCloseTo(297, 0);
    expect(page.heightMm).toBeCloseTo(210, 0);
    await printDocxDocument({ port: { print }, title: "Doc", buildCopy: () => docxPrintCopy({ doc: doc(para("a", 0)), title: "Doc" }) });
    expect(print.mock.calls[1]![0].page).toMatchObject({ landscape: false });
    expect(print.mock.calls[1]![0].page!.widthMm).toBeCloseTo(210, 0);
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
