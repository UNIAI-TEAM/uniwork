import { writeZip, type ZipInput } from "./zip.ts";

// export:page (UNI-2004): a UniNote page -> .docx. The input is the page's
// ProseMirror JSON after the server's closed-schema sanitizer
// (server/internal/document/schema.go), its title, and the bytes of the
// images it references (asset://{id}). Like docx-write.ts this is a small,
// dependency-free WordprocessingML writer: every node and mark of that schema
// maps onto a part Word and the Docs renderer both read, and nothing outside
// the schema is emitted. The typeface is Noto Sans, the font the engine
// already ships for its Vietnamese coverage (assets/fonts/PROVENANCE.md).

export class PageInputError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "PageInputError";
    this.reason = reason;
  }
}

interface PageImage {
  readonly mime: string;
  readonly data: string;
  readonly width?: number;
  readonly height?: number;
}

interface PmMark {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
}

interface PmNode {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly PmNode[];
  readonly text?: string;
  readonly marks?: readonly PmMark[];
}

/** Paragraph context: list level (-1 outside lists), the style a plain
    paragraph takes (quote, table heading), and the marker the next
    paragraph of a list item carries. */
interface Ctx {
  readonly level: number;
  readonly style?: string;
  readonly marker?: { readonly numId: number } | { readonly task: string };
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const FONT = "Noto Sans";
const MONO = "Courier New";
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif" };
const EMU_PER_PX = 9525;
/** A4 with 1-inch margins leaves 9026 twips (~601 px at 96 dpi) of text width. */
const TEXT_WIDTH_TWIPS = 9026;
const MAX_IMAGE_PX = 600;
const INDENT_TWIPS = 720;
const BULLET_NUM = 1;
/** Numbering defines levels 0-8; deeper lists reuse the last one. */
const MAX_ILVL = 8;
const REL_HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const posNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** Drop the characters XML 1.0 cannot carry (control bytes, lone surrogates). */
function clean(s: string): string {
  return s.replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "");
}
const escText = (s: string) => clean(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escAttr = (s: string) => escText(s).replaceAll('"', "&quot;");

function parseInput(input: unknown): { title: string; content: PmNode; images: Record<string, PageImage> } {
  if (!isRecord(input)) throw new PageInputError("page_input_not_object");
  if (typeof input.title !== "string") throw new PageInputError("page_title_required");
  if (!isRecord(input.content) || input.content.type !== "doc") throw new PageInputError("page_content_not_doc");
  const images: Record<string, PageImage> = {};
  if (input.images !== undefined) {
    if (!isRecord(input.images)) throw new PageInputError("page_images_invalid");
    for (const [id, image] of Object.entries(input.images)) {
      if (!isRecord(image) || typeof image.mime !== "string" || typeof image.data !== "string") {
        throw new PageInputError("page_images_invalid");
      }
      images[id] = image as unknown as PageImage;
    }
  }
  return { title: input.title, content: input.content as unknown as PmNode, images };
}

/** The sanitized page as a .docx package. Throws PageInputError on input
    that is not a page. */
export function pageToDocx(input: unknown): Uint8Array {
  const { title, content, images } = parseInput(input);
  const w = new PageWriter(images);
  const titleXml = title.trim() ? `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(title)}</w:p>` : "";
  const body = titleXml + w.blocks(content.content ?? [], { level: -1 });
  return writeZip([
    { path: "[Content_Types].xml", data: xml(CONTENT_TYPES) },
    { path: "_rels/.rels", data: xml(ROOT_RELS) },
    { path: "word/document.xml", data: xml(documentXml(body)) },
    { path: "word/styles.xml", data: xml(STYLES) },
    { path: "word/numbering.xml", data: xml(w.numberingXml()) },
    { path: "word/_rels/document.xml.rels", data: xml(w.relsXml()) },
    ...w.media,
  ]);
}

function run(text: string, marks: readonly PmMark[] = []): string {
  const has = (type: string) => marks.some((m) => m.type === type);
  let props = "";
  if (has("code")) props += '<w:rStyle w:val="CodeChar"/>';
  else if (has("link") && linkHref(marks)) props += '<w:rStyle w:val="Hyperlink"/>';
  if (has("bold")) props += "<w:b/>";
  if (has("italic")) props += "<w:i/>";
  if (has("strike")) props += "<w:strike/>";
  if (has("underline")) props += '<w:u w:val="single"/>';
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escText(text)}</w:t></w:r>`;
}

/** An external target for a link mark. Root-relative app paths have no
    origin inside a file, so they stay plain text. */
function linkHref(marks: readonly PmMark[]): string | null {
  const href = str(marks.find((m) => m.type === "link")?.attrs?.href);
  if (!href.startsWith("https://") && !href.startsWith("mailto:")) return null;
  // Word refuses a package whose relationship target is not a valid URI:
  // normalize it, and keep only the text of one that does not parse.
  try {
    // WHATWG keeps a few characters RFC 3986 forbids ("|", "^", a stray "%").
    return new URL(href).href
      .replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
      .replace(/[^\w\-.~:/?#[\]@!$&'()*+,;=%]/g, encodeURIComponent);
  } catch {
    return null;
  }
}

class PageWriter {
  readonly media: ZipInput[] = [];
  private readonly rels: string[] = [];
  private readonly ordered: { id: number; level: number; start: number }[] = [];
  private readonly hyperlinks = new Map<string, string>();
  private drawings = 0;
  private readonly images: Record<string, PageImage>;

  constructor(images: Record<string, PageImage>) {
    this.images = images;
  }

  private rel(type: string, target: string, external: boolean): string {
    // rId1/rId2 are styles and numbering.
    const id = `rId${this.rels.length + 3}`;
    this.rels.push(`<Relationship Id="${id}" Type="${type}" Target="${escAttr(target)}"${external ? ' TargetMode="External"' : ""}/>`);
    return id;
  }

  blocks(nodes: readonly PmNode[], ctx: Ctx): string {
    let out = "";
    let marker = ctx.marker;
    for (const node of nodes) {
      // Only an item's first paragraph carries its number or checkbox; the
      // rest of the item is indented under it.
      const isPara = node.type === "paragraph" || node.type === "heading";
      out += this.block(node, isPara ? { ...ctx, marker } : { ...ctx, marker: undefined });
      if (isPara) marker = undefined;
    }
    return out;
  }

  private block(n: PmNode, ctx: Ctx): string {
    const children = n.content ?? [];
    switch (n.type) {
      case "paragraph":
        return this.para(ctx, this.inline(children), ctx.style);
      case "heading": {
        const level = Math.min(Math.max(Math.trunc(posNum(n.attrs?.level) ?? 1), 1), 3);
        return this.para(ctx, this.inline(children), `Heading${level}`);
      }
      case "bulletList":
        return this.items(children, ctx, () => ({ numId: BULLET_NUM }));
      case "orderedList": {
        const id = BULLET_NUM + 1 + this.ordered.length;
        this.ordered.push({ id, level: Math.min(ctx.level + 1, MAX_ILVL), start: Math.trunc(posNum(n.attrs?.start) ?? 1) });
        return this.items(children, ctx, () => ({ numId: id }));
      }
      case "taskList":
        return this.items(children, ctx, (item) => ({ task: item.attrs?.checked === true ? "☑ " : "☐ " }));
      case "blockquote":
        return this.blocks(children, { ...ctx, style: "Quote" });
      case "codeBlock": {
        const lines = children.map((c) => str(c.text)).join("").split("\n");
        return this.para(ctx, lines.map((line, i) => (i > 0 ? "<w:r><w:br/></w:r>" : "") + run(line)).join(""), "Code");
      }
      case "horizontalRule":
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';
      case "table":
        return this.table(children);
      case "text":
      case "image":
      case "mention":
      case "hardBreak":
        return this.para(ctx, this.inline([n]), ctx.style);
      default:
        // listItem/taskItem/table parts outside their parents: keep the text.
        return this.blocks(children, ctx);
    }
  }

  private items(items: readonly PmNode[], ctx: Ctx, marker: (item: PmNode) => Ctx["marker"]): string {
    const inner: Ctx = { level: ctx.level + 1, style: ctx.style };
    return items.map((item) => this.blocks(item.content ?? [], { ...inner, marker: marker(item) })).join("");
  }

  private para(ctx: Ctx, runs: string, style?: string): string {
    let props = style ? `<w:pStyle w:val="${style}"/>` : "";
    const marker = ctx.marker;
    if (marker && "numId" in marker) {
      props += `<w:numPr><w:ilvl w:val="${Math.min(ctx.level, MAX_ILVL)}"/><w:numId w:val="${marker.numId}"/></w:numPr>`;
    } else if (ctx.level >= 0) {
      props += `<w:ind w:left="${(ctx.level + 1) * INDENT_TWIPS}"/>`;
    }
    const task = marker && "task" in marker ? run(marker.task) : "";
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${task}${runs}</w:p>`;
  }

  private inline(nodes: readonly PmNode[]): string {
    let out = "";
    for (const n of nodes) {
      const marks = n.marks ?? [];
      let r: string;
      switch (n.type) {
        case "text":
          r = run(str(n.text), marks);
          break;
        case "hardBreak":
          r = "<w:r><w:br/></w:r>";
          break;
        case "mention": {
          const label = str(n.attrs?.label);
          r = run(n.attrs?.kind === "user" ? `@${label}` : label, marks);
          break;
        }
        case "image":
          r = this.image(n);
          break;
        default:
          r = this.inline(n.content ?? []);
      }
      const href = n.type === "text" ? linkHref(marks) : null;
      if (href) {
        let id = this.hyperlinks.get(href);
        if (!id) {
          id = this.rel(REL_HYPERLINK, href, true);
          this.hyperlinks.set(href, id);
        }
        r = `<w:hyperlink r:id="${id}">${r}</w:hyperlink>`;
      }
      out += r;
    }
    return out;
  }

  private image(n: PmNode): string {
    const alt = str(n.attrs?.alt);
    const id = str(n.attrs?.src).replace(/^asset:\/\//, "");
    const image = this.images[id];
    const ext = image ? IMAGE_EXT[image.mime] : undefined;
    if (!image || !ext) return alt ? run(`[${alt}]`, [{ type: "italic" }]) : "";
    const index = this.media.length + 1;
    this.media.push({ path: `word/media/image${index}.${ext}`, data: new Uint8Array(Buffer.from(image.data, "base64")) });
    const relId = this.rel(REL_IMAGE, `media/image${index}.${ext}`, false);
    const [cx, cy] = imageSize(image, posNum(n.attrs?.width)).map((px) => Math.round(px * EMU_PER_PX));
    const doc = ++this.drawings;
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${doc}" name="Picture ${doc}" descr="${escAttr(alt)}"/>` +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      `<pic:nvPicPr><pic:cNvPr id="${doc}" name="image${index}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
    );
  }

  private table(rows: readonly PmNode[]): string {
    // Word rejects a table without rows; an empty table carries nothing.
    if (rows.length === 0) return "";
    // Lay the cells on a grid first: a rowspan covers the same columns of the
    // rows below, which Word writes as vMerge continuation cells.
    const covering = new Map<number, { span: number; left: number }>();
    let columns = 1;
    const laid = rows.map((row) => {
      const out: { cell?: PmNode; span: number; restart?: boolean }[] = [];
      let col = 0;
      const skipCovered = () => {
        for (let c = covering.get(col); c; c = covering.get(col)) {
          out.push({ span: c.span });
          if (--c.left === 0) covering.delete(col);
          col += c.span;
        }
      };
      for (const cell of row.content ?? []) {
        skipCovered();
        const span = Math.trunc(posNum(cell.attrs?.colspan) ?? 1);
        const rowspan = Math.trunc(posNum(cell.attrs?.rowspan) ?? 1);
        out.push({ cell, span, restart: rowspan > 1 });
        if (rowspan > 1) covering.set(col, { span, left: rowspan - 1 });
        col += span;
      }
      skipCovered();
      columns = Math.max(columns, col);
      return { cells: out, header: (row.content ?? []).length > 0 && (row.content ?? []).every((c) => c.type === "tableHeader") };
    });
    const grid = `<w:gridCol w:w="${Math.floor(TEXT_WIDTH_TWIPS / columns)}"/>`.repeat(columns);
    const body = laid
      .map(({ cells, header }) => {
        const tcs = cells
          .map(({ cell, span, restart }) => {
            let props = '<w:tcW w:w="0" w:type="auto"/>';
            if (span > 1) props += `<w:gridSpan w:val="${span}"/>`;
            if (!cell) props += "<w:vMerge/>";
            else if (restart) props += '<w:vMerge w:val="restart"/>';
            const isHeader = cell?.type === "tableHeader";
            if (isHeader) props += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>';
            let inner = cell ? this.blocks(cell.content ?? [], { level: -1, style: isHeader ? "TableHeading" : undefined }) : "";
            // A cell must end in a paragraph.
            if (!inner.endsWith("</w:p>") && !inner.endsWith("<w:p/>")) inner += "<w:p/>";
            return `<w:tc><w:tcPr>${props}</w:tcPr>${inner}</w:tc>`;
          })
          .join("");
        // A row must hold a cell, or Word rejects the package.
        return `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${tcs || "<w:tc><w:p/></w:tc>"}</w:tr>`;
      })
      .join("");
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
  }

  relsXml(): string {
    return (
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      this.rels.join("") +
      "</Relationships>"
    );
  }

  numberingXml(): string {
    // Each ordered list is its own num with a start override, so every list
    // restarts at its own start instead of continuing the previous one.
    const ordered = this.ordered
      .map(
        ({ id, level, start }) =>
          `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`,
      )
      .join("");
    return (
      XML_DECL +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      abstractNum(0, (i) => ["bullet", ["•", "◦", "▪"][i % 3]!]) +
      abstractNum(1, (i) => [["decimal", "lowerLetter", "lowerRoman"][i % 3]!, `%${i + 1}.`]) +
      `<w:num w:numId="${BULLET_NUM}"><w:abstractNumId w:val="0"/></w:num>` +
      ordered +
      "</w:numbering>"
    );
  }
}

function abstractNum(id: number, level: (i: number) => [string, string]): string {
  let lvls = "";
  for (let i = 0; i < 9; i++) {
    const [fmt, text] = level(i);
    lvls +=
      `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${(i + 1) * INDENT_TWIPS}" w:hanging="360"/></w:pPr></w:lvl>`;
  }
  return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${lvls}</w:abstractNum>`;
}

/** Display size in px: the node's width (or the image's own) with the
    image's aspect ratio, never wider than the text column. */
function imageSize(image: PageImage, width: number | undefined): [number, number] {
  const natW = posNum(image.width) ?? 480;
  const natH = posNum(image.height) ?? natW * 0.75;
  const w = Math.min(width ?? natW, MAX_IMAGE_PX);
  return [w, (natH * w) / natW];
}

function documentXml(body: string): string {
  return (
    XML_DECL +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body>${body}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>"
  );
}

const CONTENT_TYPES =
  XML_DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
  '<Default Extension="gif" ContentType="image/gif"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  "</Types>";

const ROOT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

const pStyle = (id: string, name: string, ppr: string, rpr: string) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
  `${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}</w:style>`;
const heading = (n: number, size: number) =>
  pStyle(`Heading${n}`, `heading ${n}`, `<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${n - 1}"/>`, `<w:b/><w:sz w:val="${size}"/>`);
const monoFonts = `<w:rFonts w:ascii="${MONO}" w:hAnsi="${MONO}" w:cs="${MONO}"/>`;

const STYLES =
  XML_DECL +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/>` +
  '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="vi-VN" w:eastAsia="vi-VN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  pStyle("Title", "Title", '<w:spacing w:after="240"/>', '<w:b/><w:sz w:val="40"/>') +
  heading(1, 32) +
  heading(2, 28) +
  heading(3, 24) +
  pStyle("Quote", "Quote", '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="720"/>', "<w:i/>") +
  pStyle("Code", "Code", '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="0"/>', `${monoFonts}<w:sz w:val="20"/>`) +
  pStyle("TableHeading", "Table Heading", '<w:spacing w:after="0"/>', "<w:b/>") +
  `<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr>${monoFonts}<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:rPr></w:style>` +
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
  ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join("") +
  '</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  "</w:styles>";

function xml(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
