import { describe, expect, it, vi } from "vitest";
import { printOrientationFromCopy, printPageFromCopy } from "./page";

const copy = (css: string) => `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><style>${css}</style></head><body><p>@page { size: 1in 9in }</p></body></html>`;

describe("printPageFromCopy", () => {
  it.each([
    ["a PPTX slide box", "@page { size: 13.333in 7.5in; margin: 0; }", { widthMm: 338.6582, heightMm: 190.5, landscape: true }],
    ["a DOCX landscape A4 section in points", ":root{--x:1}\n@page {\n  size: 841.9pt 595.3pt;\n  margin: 72pt 72pt 72pt 72pt;\n}\n@page docx-s0 {\n  size: 841.9pt 595.3pt;\n}", { widthMm: 297.0036, heightMm: 210.0086, landscape: true }],
    ["an XLSX sheet in inches", "@page{size:11.69in 8.27in;margin:0.75in 0.7in 0.75in 0.7in}", { widthMm: 296.926, heightMm: 210.058, landscape: true }],
    ["a PDF first page in points", "@page { size: 612pt 792pt; margin: 0; }\n@page pdf-size-0 { size: 612pt 792pt; margin: 0; }", { widthMm: 215.9, heightMm: 279.4, landscape: false }],
    ["Markdown's A4 default", "@page{size:A4;margin:18mm}html{color:#000}", { widthMm: 210, heightMm: 297, landscape: false }],
    ["a named size turned landscape", "@page { size: letter landscape }", { widthMm: 279.4, heightMm: 215.9, landscape: true }],
    ["a named size forced portrait", "@page { size: portrait A3 }", { widthMm: 297, heightMm: 420, landscape: false }],
    ["an orientation alone (A4 in that orientation)", "@page { size: landscape }", { widthMm: 297, heightMm: 210, landscape: true }],
    ["a square in centimetres", "@page { size: 20cm }", { widthMm: 200, heightMm: 200, landscape: false }],
  ])("reads %s", (_label, css, expected) => {
    const page = printPageFromCopy(copy(css))!;
    expect(page.landscape).toBe(expected.landscape);
    expect(page.widthMm).toBeCloseTo(expected.widthMm, 2);
    expect(page.heightMm).toBeCloseTo(expected.heightMm, 2);
  });

  it.each([
    ["no @page rule", "body{margin:0}"],
    ["only named and :first rules", "@page s1 { size: 10in 5in } @page :first { size: 10in 5in }"],
    ["a rule in a comment", "/* @page { size: 10in 5in } */ body{margin:0}"],
    ["size auto", "@page { size: auto; margin: 0 }"],
    ["an unknown name", "@page { size: B9 }"],
    ["a relative unit", "@page { size: 10em 20em }"],
    ["a zero side", "@page { size: 0in 5in }"],
  ])("gives no page for %s", (_label, css) => {
    expect(printPageFromCopy(copy(css))).toBeUndefined();
  });

  it("never reads document text as a rule", () => {
    expect(printPageFromCopy(`<html><body><p>@page { size: 10in 5in }</p></body></html>`)).toBeUndefined();
  });

  it("never parses the copy into a DOM (a 16 MiB copy is read in place, once per run)", () => {
    const parser = vi.fn();
    vi.stubGlobal("DOMParser", parser);
    try {
      const page = printPageFromCopy(copy("@page { size: 13.333in 7.5in }") + "x".repeat(2_000_000));
      expect(page?.landscape).toBe(true);
      expect(parser).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads the first rule of any <style> element, with attributes, and skips a commented-out one", () => {
    const html = `<html><head><!-- <style>@page { size: 1in 1in }</style> --><STYLE type="text/css" media="print">@page { size: 10in 5in }</STYLE><style>@page { size: 2in 2in }</style></head></html>`;
    expect(printPageFromCopy(html)).toMatchObject({ widthMm: 254, heightMm: 127, landscape: true });
  });

  it("reads a size on a later <style> when an earlier one has no rule", () => {
    const html = `<html><head><style>body{margin:0}</style><style>@page{size:A3 landscape}</style></head></html>`;
    expect(printPageFromCopy(html)).toMatchObject({ widthMm: 420, heightMm: 297, landscape: true });
  });
});

describe("a page rule that nests margin boxes", () => {
  const nested = "@page { size: 792pt 612pt; margin: 36pt; @top-left { content: 'x'; size: 1in 9in } @bottom-center { content: counter(page) } }";

  it("reads its size like any other rule, and never a size inside a margin box", () => {
    expect(printPageFromCopy(copy(nested))).toMatchObject({ landscape: true, widthMm: expect.closeTo(279.4, 1), heightMm: expect.closeTo(215.9, 1) });
    expect(printOrientationFromCopy(copy(nested))).toBe("landscape");
    expect(printOrientationFromCopy(copy("@page wide { margin: 0; @top-left { size: 10in 5in } }"))).toBeUndefined();
  });

  it("reads a named rule and keeps reading the rules after it", () => {
    const css = "@page { size: 612pt 792pt } @page wide { size: 792pt 612pt; @top-right { content: 'y' } } @page tall { size: 612pt 792pt }";
    expect(printOrientationFromCopy(copy(css))).toBe("mixed");
  });

  it("takes the first unnamed rule that states a size, skipping a margin-box-only one before it", () => {
    expect(printPageFromCopy(copy("@page { @top-left { content: 'x' } } @page { size: A4 landscape }"))).toMatchObject({ landscape: true, widthMm: 297 });
  });

  it("gives up on an unbalanced rule instead of reading past it", () => {
    expect(printPageFromCopy(copy("@page { size: A4 landscape; @top-left { content: 'x' }"))).toBeUndefined();
    expect(printOrientationFromCopy(copy("@page { size: A4; @top-left { content: 'x' } @page tall { size: 10in 20in }"))).toBeUndefined();
  });
});

describe("printOrientationFromCopy", () => {
  it.each([
    ["a DOCX with a portrait then a landscape section", "@page { size: 612pt 792pt; margin: 72pt }\n@page docx-s0 { size: 612pt 792pt; margin: 72pt }\n@page docx-s1 { size: 792pt 612pt; margin: 72pt }", "mixed"],
    ["a DOCX with a landscape then a portrait section", "@page { size: 792pt 612pt }\n@page docx-s0 { size: 792pt 612pt }\n@page docx-s1 { size: 612pt 792pt }", "mixed"],
    ["a PDF with mixed page sizes", "@page { size: 612pt 792pt; margin: 0; }\n@page pdf-size-0 { size: 612pt 792pt; margin: 0; }\n@page pdf-size-1 { size: 792pt 612pt; margin: 0; }", "mixed"],
    ["an all-landscape DOCX", "@page { size: 841.9pt 595.3pt }\n@page docx-s0 { size: 841.9pt 595.3pt }\n@page docx-s1 { size: 841.9pt 595.3pt }", "landscape"],
    ["a PPTX slide box", "@page { size: 13.333in 7.5in; margin: 0; }", "landscape"],
    ["an all-portrait PDF", "@page { size: 612pt 792pt; margin: 0; }\n@page pdf-size-0 { size: 612pt 792pt; margin: 0; }", "portrait"],
    ["a square page", "@page { size: 20cm }", "portrait"],
    ["a landscape section after an unnamed A4 default", "@page{size:A4;margin:18mm}@page wide{size:A4 landscape}", "mixed"],
  ])("reads %s", (_label, css, expected) => {
    expect(printOrientationFromCopy(copy(css))).toBe(expected);
  });

  it("skips margin-box rules, pseudo-class rules and commented-out rules", () => {
    const css = "@page { size: 612pt 792pt }\n@page docx-s0 { margin: 0; @top-left { content: 'x' } }\n@page docx-s0:first { size: 792pt 612pt }\n/* @page late { size: 792pt 612pt } */";
    expect(printOrientationFromCopy(copy(css))).toBe("portrait");
  });

  it.each([
    ["no rule", "body{margin:0}"],
    ["size auto", "@page { size: auto }"],
    ["a relative unit", "@page { size: 10em 20em }"],
  ])("gives nothing for %s", (_label, css) => {
    expect(printOrientationFromCopy(copy(css))).toBeUndefined();
  });

  it("reads rules across several <style> elements and never document text", () => {
    const html = `<html><head><style>@page { size: A4 }</style><style>@page wide { size: A4 landscape }</style></head><body><p>@page x { size: 1in 9in }</p></body></html>`;
    expect(printOrientationFromCopy(html)).toBe("mixed");
  });

  it("never parses the copy into a DOM", () => {
    const parser = vi.fn();
    vi.stubGlobal("DOMParser", parser);
    try {
      expect(printOrientationFromCopy(copy("@page { size: 13.333in 7.5in }") + "x".repeat(2_000_000))).toBe("landscape");
      expect(parser).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
