import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { docxDocumentToHtml, escapeDocxHtmlText, serializeDocxInline } from "./docx-html-export";

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function paragraph(text: string, marks?: JSONContent["marks"]): JSONContent {
  return { type: "docParagraph", attrs: {}, content: [{ type: "text", text, ...(marks ? { marks } : {}) }] };
}

function listItem(text: string, kind: "bullet" | "ordered", ilvl = 0): JSONContent {
  return { type: "docListItem", attrs: { kind, numId: "1", ilvl }, content: [{ type: "text", text }] };
}

function tableCell(text: string, header = false): JSONContent {
  return {
    type: header ? "docTableHeader" : "docTableCell",
    attrs: {},
    content: [paragraph(text)],
  };
}

describe("escapeDocxHtmlText", () => {
  it("escapes markup characters", () => {
    expect(escapeDocxHtmlText(`<b>&"x"</b>`)).toBe("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
  });
});

describe("docxDocumentToHtml", () => {
  it("escapes every text node", () => {
    const html = docxDocumentToHtml(doc(paragraph(`<script>alert("x")</script> & more`)), { title: "T" });
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more");
    expect(html).not.toContain("<script>");
  });

  it("escapes the title and never closes it early", () => {
    const html = docxDocumentToHtml(doc(paragraph("body")), { title: "</title><script>x</script>" });
    expect(html).toContain("<title>&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>");
    expect(html).not.toContain("</title><script>");
  });

  it("emits a complete standalone document with embedded styles", () => {
    const html = docxDocumentToHtml(doc(paragraph("Hello")), { title: "Doc", pageWidthPx: 620.4 });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain('<article class="docx-export" style="max-width:620px">');
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("quotes each family of a fallback list separately", () => {
    const html = docxDocumentToHtml(doc(paragraph("x")), { fontFamily: '"Segoe UI", Arial, sans-serif' });
    expect(html).toContain("body{font-family:'Segoe UI', 'Arial', 'sans-serif'}");
  });

  it("drops a font-family the whitelist refuses", () => {
    const html = docxDocumentToHtml(doc(paragraph("x")), { fontFamily: "Arial;background:url(https://evil.test/i)" });
    expect(html).not.toContain("font-family");
  });

  it("renders headings with the level clamped to h1..h6", () => {
    const html = docxDocumentToHtml(
      doc(
        { type: "docHeading", attrs: { level: 2 }, content: [{ type: "text", text: "Two" }] },
        { type: "docHeading", attrs: { level: 9 }, content: [{ type: "text", text: "Deep" }] },
      ),
    );
    expect(html).toContain("<h2>Two</h2>");
    expect(html).toContain("<h6>Deep</h6>");
  });

  it("groups consecutive list items and nests by ilvl", () => {
    const html = docxDocumentToHtml(
      doc(
        listItem("One", "ordered"),
        listItem("Two", "ordered"),
        listItem("Nested", "bullet", 1),
        paragraph("After"),
      ),
    );
    expect(html).toContain("<ol><li>One</li><li>Two<ul><li>Nested</li></ul></li></ol><p>After</p>");
    expect(html).not.toContain("</li></ul><li>");
  });

  it("starts a new list when the kind changes", () => {
    const html = docxDocumentToHtml(doc(listItem("Bullet", "bullet"), listItem("Number", "ordered")));
    expect(html).toContain("<ul><li>Bullet</li></ul><ol><li>Number</li></ol>");
  });

  it("renders tables with header cells", () => {
    const html = docxDocumentToHtml(
      doc({
        type: "docTable",
        attrs: {},
        content: [
          { type: "docTableRow", content: [tableCell("Name", true), tableCell("Value", true)] },
          { type: "docTableRow", content: [tableCell("A"), tableCell("1")] },
        ],
      }),
    );
    expect(html).toContain("<table><tbody><tr><th><p>Name</p></th><th><p>Value</p></th></tr><tr><td><p>A</p></td><td><p>1</p></td></tr></tbody></table>");
  });

  it("keeps image data URIs and drops unsafe sources", () => {
    const html = docxDocumentToHtml(
      doc(
        paragraph("x"),
        {
          type: "docParagraph",
          content: [
            { type: "docInlineImage", attrs: { dataUrl: "data:image/png;base64,AAAA", widthPx: 10, heightPx: 20 } },
            { type: "docInlineImage", attrs: { dataUrl: "javascript:alert(1)" } },
          ],
        },
      ),
    );
    expect(html).toContain('<img src="data:image/png;base64,AAAA" width="10" height="20" alt="">');
    expect(html).not.toContain("javascript:");
  });

  it("keeps run marks as semantic tags", () => {
    const html = docxDocumentToHtml(
      doc(paragraph("Bold", [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }])),
    );
    expect(html).toContain("<p><strong><em><u><s>Bold</s></u></em></strong></p>");
  });

  it("keeps safe links and drops script URLs", () => {
    const html = serializeDocxInline([
      { type: "text", text: "Site", marks: [{ type: "link", attrs: { href: "https://uniwork.test/a?b=1&c=2" } }] },
      { type: "text", text: "Evil", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
    ]);
    expect(html).toContain('<a href="https://uniwork.test/a?b=1&amp;c=2">Site</a>');
    expect(html).toContain("Evil");
    expect(html).not.toContain("javascript:");
  });

  it("inlines validated docTextStyle attributes and drops hidden text", () => {
    const html = serializeDocxInline([
      { type: "text", text: "Red", marks: [{ type: "docTextStyle", attrs: { color: "FF0000", sizeHalfPoints: 28, boldOff: true } }] },
      { type: "text", text: "Hidden", marks: [{ type: "docTextStyle", attrs: { vanish: true } }] },
      { type: "text", text: "Injected", marks: [{ type: "docTextStyle", attrs: { color: 'red;background:url(x)' } }] },
    ]);
    expect(html).toContain('<span style="color:#FF0000;font-size:14pt;font-weight:normal">Red</span>');
    expect(html).not.toContain("Hidden");
    expect(html).toContain("Injected");
    expect(html).not.toContain("url(x)");
  });

  it("falls back to text for unknown nodes instead of dropping content", () => {
    const html = docxDocumentToHtml(doc({ type: "mysteryNode", content: [{ type: "text", text: "kept" }] }));
    expect(html).toContain("kept");
  });

  it("renders note references, ruby and math as escaped inline markup", () => {
    const html = serializeDocxInline([
      { type: "docNoteRef", attrs: { kind: "footnote", id: "f1", num: 3 } },
      { type: "docRuby", attrs: { base: "漢", rt: "かん" } },
      { type: "docInlineMath", attrs: { text: "x<2" } },
      { type: "docHardBreak" },
    ]);
    expect(html).toBe('<sup class="docx-note-ref">3</sup><ruby>漢<rt>かん</rt></ruby><span class="docx-math">x&lt;2</span><br>');
  });

  it("serializes paragraph alignment and page break before", () => {
    const html = docxDocumentToHtml(
      doc({ type: "docParagraph", attrs: { align: "center", pageBreakBefore: true }, content: [{ type: "text", text: "C" }] }),
    );
    expect(html).toContain('<p style="text-align:center;page-break-before:always">C</p>');
  });
});
