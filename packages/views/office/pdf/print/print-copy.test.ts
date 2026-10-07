import { describe, expect, it } from "vitest";
import { PRINT_COPY_CSP } from "../../markdown/wysiwyg/print";
import { buildPdfPrintCopy } from "./print-copy";
import { PdfPrintError, type PdfPrintPage } from "./types";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function page(pageNumber: number, widthPt: number, heightPt: number, src = PNG): PdfPrintPage {
  return { pageNumber, widthPt, heightPt, src };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("buildPdfPrintCopy", () => {
  it("puts every original page on its own sheet, in order, starting with page 1", () => {
    const doc = parse(buildPdfPrintCopy({ pages: [page(1, 595, 842), page(2, 595, 842), page(3, 595, 842)], title: "Report" }));
    const sheets = Array.from(doc.querySelectorAll(".pdf-print-page"));

    expect(sheets.map((sheet) => sheet.getAttribute("data-page"))).toEqual(["1", "2", "3"]);
    expect(doc.body.firstElementChild).toBe(sheets[0]);
    expect(doc.querySelectorAll("img")).toHaveLength(3);
  });

  it("gives each distinct page size its own zero-margin @page, so mixed portrait and landscape keep their sheets", () => {
    const html = buildPdfPrintCopy({ pages: [page(1, 595.276, 841.89), page(2, 841.89, 595.276), page(3, 595.276, 841.89)], title: "Mixed" });
    const doc = parse(html);
    const style = doc.querySelector("style")?.textContent ?? "";

    expect(style).toContain("@page { size: 595.27pt 841.89pt; margin: 0; }");
    expect(style).toContain("@page pdf-size-0 { size: 595.27pt 841.89pt; margin: 0; }");
    expect(style).toContain("@page pdf-size-1 { size: 841.89pt 595.27pt; margin: 0; }");
    expect(style).toContain(".pdf-size-0 { page: pdf-size-0; width: 595.27pt; height: 841.89pt; }");
    expect(style).toContain(".pdf-size-1 { page: pdf-size-1; width: 841.89pt; height: 595.27pt; }");
    expect(style).not.toContain("pdf-size-2");
    expect(style).toContain("break-after: page");
    expect(style).toContain("print-color-adjust: exact");
    const classes = Array.from(doc.querySelectorAll(".pdf-print-page")).map((sheet) => sheet.className);
    expect(classes).toEqual(["pdf-print-page pdf-size-0", "pdf-print-page pdf-size-1", "pdf-print-page pdf-size-0"]);
  });

  it("carries only inline data: images, the print CSP and no script", () => {
    const doc = parse(buildPdfPrintCopy({ pages: [page(1, 612, 792), page(2, 612, 792, "data:image/jpeg;base64,/9j/4AAQ")], title: "Letter" }));

    for (const image of Array.from(doc.querySelectorAll("img"))) expect(image.getAttribute("src")).toMatch(/^data:image\//);
    expect(doc.querySelector("meta[http-equiv='Content-Security-Policy']")?.getAttribute("content")).toBe(PRINT_COPY_CSP);
    expect(doc.querySelectorAll("script, iframe, object, embed, link, base")).toHaveLength(0);
  });

  it("escapes the title so document metadata cannot inject markup", () => {
    const html = buildPdfPrintCopy({ pages: [page(1, 100, 100)], title: "</title><script>alert(1)</script>", lang: "vi\"><x" });
    const doc = parse(html);

    expect(doc.title).toBe("</title><script>alert(1)</script>");
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.documentElement.getAttribute("lang")).toBe("vi\"><x");
  });

  it.each([
    ["a remote URL", "https://example.test/page.png"],
    ["a blob URL", "blob:https://app.test/1"],
    ["an SVG data URL", "data:image/svg+xml;base64,PHN2Zz4="],
    ["an HTML data URL", "data:text/html;base64,PGI+"],
    ["an attribute break-out", "data:image/png;base64,AA\" onerror=\"x"],
  ])("refuses %s as a page image", (_label, src) => {
    expect(() => buildPdfPrintCopy({ pages: [page(1, 100, 100, src)], title: "x" })).toThrow(PdfPrintError);
    expect(() => buildPdfPrintCopy({ pages: [page(1, 100, 100, src)], title: "x" })).toThrow(expect.objectContaining({ code: "render_failed" }));
  });

  it("refuses an empty document and a page without a size", () => {
    expect(() => buildPdfPrintCopy({ pages: [], title: "x" })).toThrow(expect.objectContaining({ code: "no_pages" }));
    expect(() => buildPdfPrintCopy({ pages: [page(1, 0, 100)], title: "x" })).toThrow(expect.objectContaining({ code: "render_failed" }));
  });
});
