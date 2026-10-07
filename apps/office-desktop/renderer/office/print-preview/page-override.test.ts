// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { withChosenSheet } from "./page-override";

const a4 = { landscape: false, pageSize: { width: 210_000, height: 297_000 } };
const copy = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="style-src 'unsafe-inline'"><style>@page sec1{size:210mm 297mm}</style><title>Doc</title></head><body><p>x</p></body></html>`;

describe("withChosenSheet", () => {
  it("leaves the copy untouched on the document's own sheet", () => {
    expect(withChosenSheet(copy, a4, a4)).toBe(copy);
  });

  it("appends one style last in the head that re-sizes the unnamed and every named page", () => {
    const out = withChosenSheet(copy, { ...a4, landscape: true }, a4);
    const doc = new DOMParser().parseFromString(out, "text/html");
    const styles = Array.from(doc.head.querySelectorAll("style"));
    expect(styles.at(-1)?.hasAttribute("data-print-sheet")).toBe(true);
    expect(styles.at(-1)?.textContent).toBe("@page{size:297mm 210mm}@page:first{size:297mm 210mm}@page sec1{size:297mm 210mm}@page sec1:first{size:297mm 210mm}");
    expect(doc.head.firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(doc.body.textContent).toBe("x");
  });

  it("lays a changed paper out portrait short side first", () => {
    const out = withChosenSheet(copy, { landscape: false, pageSize: { width: 297_000, height: 420_000 } }, a4);
    expect(out).toContain("@page{size:297mm 420mm}");
  });

  it("keeps each page's margins and margin boxes: only size is re-declared, names are listed once", () => {
    const named = copy.replace("<title>", "<style>@page sec1 :first{margin:0}@page sec2{size:420mm 297mm;@top-center{content:url(data:x)}}</style><title>");
    const rules = new DOMParser().parseFromString(withChosenSheet(named, { ...a4, landscape: true }, a4), "text/html").head.querySelector("style[data-print-sheet]")?.textContent ?? "";
    expect(rules.match(/@page sec1{/g)).toHaveLength(1);
    expect(rules).toContain("@page sec2{size:297mm 210mm}");
    expect(rules).not.toMatch(/margin|content|page:auto/);
  });
});

describe("named pages", () => {
  it("reads page names from style elements only, never from the body text", () => {
    const prose = copy.replace("<p>x</p>", "<p>Write @page foo { size: 1mm 1mm } in a rule</p>");
    const rules = new DOMParser().parseFromString(withChosenSheet(prose, { ...a4, landscape: true }, a4), "text/html").head.querySelector("style[data-print-sheet]")?.textContent ?? "";
    expect(rules).not.toContain("foo");
    expect(rules).toContain("@page sec1{size:297mm 210mm}");
  });
});

describe("a fixed-page PDF copy", () => {
  const pdfCopy = `<!DOCTYPE html><html><head><style>@page{size:595pt 842pt;margin:0}@page pdf-size-0{size:595pt 842pt;margin:0}.pdf-size-0{page:pdf-size-0;width:595pt;height:842pt}.pdf-print-page img{width:100%;height:100%}</style></head><body><div class="pdf-print-page pdf-size-0"><img src="data:image/png;base64,AA" alt=""></div></body></html>`;

  it("fits each page box to the chosen landscape sheet so a page never spills onto a second one", () => {
    const out = withChosenSheet(pdfCopy, { ...a4, landscape: true }, a4);
    const rules = new DOMParser().parseFromString(out, "text/html").head.querySelector("style[data-print-sheet]")?.textContent ?? "";
    expect(rules).toContain("@page pdf-size-0{size:297mm 210mm}");
    expect(rules).toContain(".pdf-print-page{width:297mm!important;height:210mm!important}");
    expect(rules).toContain(".pdf-print-page img{object-fit:contain}");
  });

  it("fits a changed paper in portrait", () => {
    const rules = new DOMParser().parseFromString(withChosenSheet(pdfCopy, { landscape: false, pageSize: { width: 215_900, height: 279_400 } }, a4), "text/html").head.querySelector("style[data-print-sheet]")?.textContent ?? "";
    expect(rules).toContain(".pdf-print-page{width:215.9mm!important;height:279.4mm!important}");
  });

  it("adds no fit rule to a reflowing copy, nor when the sheet is the document's own", () => {
    const reflow = withChosenSheet(copy, { ...a4, landscape: true }, a4);
    expect(reflow).not.toContain("pdf-print-page");
    expect(withChosenSheet(pdfCopy, a4, a4)).toBe(pdfCopy);
  });

  it("does not take a page box mentioned in body text for a fixed-page copy", () => {
    const prose = copy.replace("<p>x</p>", "<p>the pdf-print-page class</p>");
    expect(withChosenSheet(prose, { ...a4, landscape: true }, a4)).not.toContain("!important");
  });
});
