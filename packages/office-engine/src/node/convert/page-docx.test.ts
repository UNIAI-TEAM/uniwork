// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PageInputError, pageToDocx } from "./page-docx.ts";
import { readZip } from "./zip.ts";

// export:page (UNI-2004): a sanitized UniNote page -> a DOCX that Word opens.
// The fixture carries every node and mark of the closed page schema
// (server/internal/document/schema.go) with Vietnamese text; the oracle is
// the package itself, read back with the converter's own zip reader and a
// real XML parser.

const ASSET = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const MISSING = "01JABCDEFGHJKMNPQRSTVWXYZ1";
// A 1x1 PNG: the bytes must reach word/media unchanged.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const cell = (type: string, t: string, attrs?: Record<string, number>) => ({ type, ...(attrs ? { attrs } : {}), content: [para(text(t))] });

const page = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Thành phần tham dự")] },
    para(
      text("Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ đ Ư ơ "),
      text("đậm", [{ type: "bold" }]),
      text(" nghiêng", [{ type: "italic" }]),
      text(" gạch chân", [{ type: "underline" }]),
      text(" gạch ngang", [{ type: "strike" }]),
      text(" mã", [{ type: "code" }]),
      { type: "hardBreak" },
      text("liên kết", [{ type: "link", attrs: { href: "https://example.com/biên-bản?a=1&b=2" } }]),
      text(" nội bộ", [{ type: "link", attrs: { href: "/org/ws/documents/x" } }]),
      text(" a < b & c\u0001"),
      { type: "mention", attrs: { kind: "user", id: ASSET, label: "Nguyễn Văn A" } },
      { type: "mention", attrs: { kind: "task", id: ASSET, label: "Việc 1" } },
    ),
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            para(text("Mục một")),
            para(text("Đoạn tiếp của mục một")),
            { type: "bulletList", content: [{ type: "listItem", content: [para(text("Mục lồng"))] }] },
          ],
        },
      ],
    },
    { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [para(text("Bước ba"))] }] },
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [para(text("Đã xong"))] },
        { type: "taskItem", attrs: { checked: false }, content: [para(text("Chưa xong"))] },
      ],
    },
    { type: "blockquote", content: [para(text("Trích dẫn"))] },
    { type: "codeBlock", attrs: { language: "go" }, content: [text("x := 1\ny := 2")] },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "Người", { colspan: 2 }), cell("tableHeader", "Hạn")] },
        { type: "tableRow", content: [cell("tableCell", "An", { rowspan: 2 }), cell("tableCell", "Bình"), cell("tableCell", "Thứ hai")] },
        { type: "tableRow", content: [cell("tableCell", "Chi"), { type: "tableCell", content: [] }] },
      ],
    },
    para({ type: "image", attrs: { src: `asset://${ASSET}`, alt: "Sơ đồ", width: 300 } }),
    { type: "image", attrs: { src: `asset://${MISSING}`, alt: "Ảnh thiếu" } },
    { type: "paragraph" },
  ],
};

const images = {
  [ASSET]: { mime: "image/png", data: Buffer.from(PNG).toString("base64"), width: 600, height: 400 },
};

const docx = () => readZip(pageToDocx({ title: "Biên bản họp <tháng 10>", content: page, images }));
const part = (pkg: Map<string, Uint8Array>, path: string): string => {
  const entry = pkg.get(path);
  if (!entry) throw new Error("missing part " + path);
  return new TextDecoder().decode(entry);
};
const wellFormed = (xml: string) => {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);
};

describe("pageToDocx", () => {
  it("writes a package whose every XML part parses", () => {
    const pkg = docx();
    for (const [path, bytes] of pkg) {
      if (path.endsWith(".xml") || path.endsWith(".rels")) wellFormed(new TextDecoder().decode(bytes));
    }
    expect([...pkg.keys()]).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "word/styles.xml",
        "word/numbering.xml",
        "word/_rels/document.xml.rels",
        "word/media/image1.png",
      ]),
    );
    const types = part(pkg, "[Content_Types].xml");
    expect(types).toContain('Extension="png"');
    expect(types).toContain("/word/numbering.xml");
  });

  it("carries the title, the Vietnamese text and every mark", () => {
    const body = part(docx(), "word/document.xml");
    expect(body).toContain('<w:pStyle w:val="Title"/>');
    expect(body).toContain("Biên bản họp &lt;tháng 10&gt;");
    expect(body).toContain("Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ đ Ư ơ ");
    expect(body).toContain('<w:pStyle w:val="Heading2"/>');
    for (const mark of ["<w:b/>", "<w:i/>", '<w:u w:val="single"/>', "<w:strike/>", '<w:rStyle w:val="CodeChar"/>']) {
      expect(body).toContain(mark);
    }
    expect(body).toContain("<w:br/>");
    expect(body).toContain(" a &lt; b &amp; c");
    expect(body).not.toContain("\u0001");
    expect(body).toContain("@Nguyễn Văn A");
    expect(body).toContain(">Việc 1<");
  });

  it("links https targets as external hyperlinks and keeps internal paths as text", () => {
    const pkg = docx();
    const body = part(pkg, "word/document.xml");
    const rels = part(pkg, "word/_rels/document.xml.rels");
    const id = /<w:hyperlink r:id="(rId\d+)">/.exec(body)?.[1];
    expect(id).toBeDefined();
    expect(rels).toContain(`Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/bi%C3%AAn-b%E1%BA%A3n?a=1&amp;b=2" TargetMode="External"`);
    expect(body.match(/<w:hyperlink /g)).toHaveLength(1);
    expect(body).toContain(" nội bộ");
  });

  it("numbers lists with nesting, a restart and a continuation paragraph", () => {
    const pkg = docx();
    const body = part(pkg, "word/document.xml");
    const numbering = part(pkg, "word/numbering.xml");
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>');
    expect(numbering).toContain('<w:numFmt w:val="decimal"/>');
    expect(numbering).toContain('<w:startOverride w:val="3"/>');
    expect(body).toContain('<w:ilvl w:val="1"/>');
    // "Đoạn tiếp" sits in the item without a second number.
    const cont = body.slice(0, body.indexOf("Đoạn tiếp của mục một"));
    expect(cont.slice(cont.lastIndexOf("<w:p>"))).not.toContain("<w:numPr>");
    // Task boxes and nested bullets use characters Noto Sans (the PDF font) has.
    expect(body).toContain("[x] ");
    expect(body).toContain("[ ] ");
    expect(body + numbering).not.toMatch(/[☐☑◦▪]/);
    expect(numbering).toContain('<w:lvlText w:val="–"/>');
  });

  it("styles quotes, code and the rule", () => {
    const body = part(docx(), "word/document.xml");
    expect(body).toContain('<w:pStyle w:val="Quote"/>');
    expect(body).toContain('<w:pStyle w:val="Code"/>');
    expect(body).toMatch(/x := 1<\/w:t><\/w:r><w:r>(<w:rPr>.*?<\/w:rPr>)?<w:br\/>/);
    expect(body).toContain("<w:pBdr><w:bottom ");
  });

  it("lays tables out on a grid, with merged columns and rows", () => {
    const body = part(docx(), "word/document.xml");
    expect(body).toContain("<w:tbl>");
    expect(body.match(/<w:gridCol /g)).toHaveLength(3);
    expect(body).toContain('<w:gridSpan w:val="2"/>');
    expect(body).toContain('<w:vMerge w:val="restart"/>');
    expect(body).toContain("<w:vMerge/>");
    expect(body).toContain("<w:tblHeader/>");
    // Every cell ends in a paragraph, the empty one too.
    expect(body).not.toMatch(/<\/w:tcPr><\/w:tc>/);
  });

  it("embeds the page's images and names the ones it does not have", () => {
    const pkg = docx();
    expect(pkg.get("word/media/image1.png")).toEqual(PNG);
    const body = part(pkg, "word/document.xml");
    const rels = part(pkg, "word/_rels/document.xml.rels");
    const id = /<a:blip r:embed="(rId\d+)"\/>/.exec(body)?.[1];
    expect(rels).toContain(`Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"`);
    // width 300px of a 600x400 image keeps the aspect: 300x200 px in EMU.
    expect(body).toContain('<wp:extent cx="2857500" cy="1905000"/>');
    expect(body).toContain('descr="Sơ đồ"');
    expect(body).toContain("[Ảnh thiếu]");
  });

  it("declares a typeface with Vietnamese coverage", () => {
    expect(part(docx(), "word/styles.xml")).toContain('w:ascii="Noto Sans" w:hAnsi="Noto Sans" w:cs="Noto Sans" w:eastAsia="Noto Sans"');
  });

  it("drops a table with no rows and gives a row with no cells one empty cell", () => {
    const body = (content: unknown[]) => part(readZip(pageToDocx({ title: "", content: { type: "doc", content } })), "word/document.xml");
    expect(body([{ type: "table", content: [] }, para(text("sau bảng"))])).not.toContain("<w:tbl>");
    const xml = body([{ type: "table", content: [{ type: "tableRow", content: [] }] }]);
    wellFormed(xml);
    expect(xml).toContain("<w:tr><w:tc><w:p/></w:tc></w:tr>");
  });

  it("keeps lists deeper than nine levels on the last numbering level", () => {
    let list: unknown = para(text("đáy"));
    for (let i = 0; i < 11; i++) list = { type: i % 2 ? "bulletList" : "orderedList", content: [{ type: "listItem", content: [para(text(`cấp ${i}`)), list] }] };
    const pkg = readZip(pageToDocx({ title: "", content: { type: "doc", content: [list] } }));
    const levels = [...part(pkg, "word/document.xml").matchAll(/<w:ilvl w:val="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(Math.max(...levels)).toBe(8);
    const overrides = [...part(pkg, "word/numbering.xml").matchAll(/<w:lvlOverride w:ilvl="(\d+)">/g)].map((m) => Number(m[1]));
    expect(Math.max(...overrides)).toBeLessThanOrEqual(8);
  });

  it("normalizes link targets and keeps only the text of one that does not parse", () => {
    const link = (href: string) => text(`t-${href}`, [{ type: "link", attrs: { href } }]);
    const pkg = readZip(pageToDocx({ title: "", content: { type: "doc", content: [para(link("https://a.vn/x|y"), link("https://a.vn/đường dẫn"), link("https://%zz"), link("https://a.vn/50%zz"))] } }));
    const rels = part(pkg, "word/_rels/document.xml.rels");
    expect(rels).toContain('Target="https://a.vn/x%7Cy"');
    expect(rels).toContain('Target="https://a.vn/%C4%91%C6%B0%E1%BB%9Dng%20d%E1%BA%ABn"');
    expect(rels).toContain('Target="https://a.vn/50%25zz"');
    expect(rels).not.toContain("https://%zz");
    const body = part(pkg, "word/document.xml");
    expect(body.match(/<w:hyperlink /g)).toHaveLength(3);
    expect(body).toContain("t-https://%zz");
  });

  it("writes an empty page and refuses input that is not a page", () => {
    expect(part(readZip(pageToDocx({ title: "", content: { type: "doc" } })), "word/document.xml")).toContain("<w:body>");
    for (const bad of [null, "x", { title: 1, content: { type: "doc" } }, { title: "t", content: { type: "paragraph" } }, { title: "t", content: { type: "doc" }, images: { a: { mime: 1 } } }]) {
      expect(() => pageToDocx(bad)).toThrow(PageInputError);
    }
  });
});
