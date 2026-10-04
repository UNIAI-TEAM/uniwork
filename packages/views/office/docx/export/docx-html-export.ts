// C1 (UNI-924): standalone HTML export for the open DOCX document.
//
// The serializer walks the editor's JSON document (the same model the save
// bridge captures) and emits semantic HTML: paragraphs, headings, lists and
// tables, with run-level styles inlined from the docTextStyle mark. Working
// from the model instead of the live DOM keeps the output deterministic and
// testable, and it never re-emits markup from document content: every text
// node and every attribute value is escaped, unsafe links and image sources
// are dropped, so a document can never smuggle script into the downloaded
// file (security rule: no raw innerHTML from document content).
//
// Deliberate limits are named in the worker report: nested tables
// (docNestedTable carries a table model, not content), cell borders/shading,
// paragraph indents/spacing, footnotes' bodies and rendered math (inline math
// exports its linearized text; MathML would need sanitizing) are not serialized.

import type { JSONContent } from "@tiptap/core";

export interface DocxHtmlExportOptions {
  /** <title> of the exported file; the caller passes the localized document name. */
  title?: string;
  /** BCP-47 language for the root element (the document's own language when known). */
  lang?: string;
  /** Content width in px (the section page box minus its margins). */
  pageWidthPx?: number;
  /** Body font family of the open surface at export time. */
  fontFamily?: string;
  /** Body text colour of the open surface at export time. */
  textColor?: string;
}

/** OOXML named highlight -> CSS colour, mirroring the renderer's table. */
const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#FFFF00",
  green: "#00FF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  blue: "#0000FF",
  red: "#FF0000",
  darkblue: "#00008B",
  darkcyan: "#008B8B",
  darkgreen: "#006400",
  darkmagenta: "#8B008B",
  darkred: "#8B0000",
  darkyellow: "#808000",
  darkgray: "#808080",
  lightgray: "#C0C0C0",
  black: "#000000",
  white: "#FFFFFF",
};

/** Links are exported only for schemes a downloaded file may safely follow. */
const SAFE_LINK_HREF = /^(?:https?:|mailto:|tel:|#)/i;
/** Images are exported as data URIs (the model's own form) or absolute http(s). */
const SAFE_IMAGE_SOURCE = /^(?:data:image\/[a-z0-9.+-]+[;,]|https?:\/\/)/i;
const SAFE_HEX_COLOR = /^[0-9A-Fa-f]{6}$/;
const SAFE_FONT_FAMILY = /^[\p{L}\p{N}\s,'".()-]+$/u;
const SAFE_LANG = /^[A-Za-z0-9-]+$/;
const SAFE_CSS_COLOR = /^(?:#[0-9A-Fa-f]{3,8}|rgba?\([\d\s.,%/]+\))$/;

/** Marks render in a fixed nesting order so the same model always emits the same file. */
const MARK_PRIORITY: Record<string, number> = {
  bold: 10,
  italic: 20,
  underline: 30,
  strike: 40,
  ins: 50,
  del: 60,
  link: 70,
  docTextStyle: 80,
};

export function escapeDocxHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeDocxHtmlAttribute(value: string): string {
  return escapeDocxHtmlText(value);
}

function hexColor(value: unknown): string | null {
  return typeof value === "string" && SAFE_HEX_COLOR.test(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveInt(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? Math.round(parsed) : null;
}

function formatCssNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function safeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || !SAFE_FONT_FAMILY.test(trimmed)) return null;
  const families = trimmed
    .split(",")
    .map((family) => family.replace(/['"]/g, "").trim())
    .filter((family) => family.length > 0);
  if (families.length === 0) return null;
  return families.map((family) => `'${family}'`).join(", ");
}

function safeCssColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_CSS_COLOR.test(trimmed) ? trimmed : null;
}

/** One run's docTextStyle attrs -> inline CSS on a span. Unknown/unsafe values are dropped. */
function textStyleSpan(attrs: Record<string, unknown>, inner: string): string {
  // Hidden (w:vanish) text: Word never displays or prints it, so it must not
  // appear in the exported file either.
  if (attrs.vanish === true) return "";
  const styles: string[] = [];
  const color = hexColor(attrs.color);
  if (color) styles.push(`color:#${color}`);
  const sizeHalfPoints = finiteNumber(attrs.sizeHalfPoints);
  if (sizeHalfPoints !== null && sizeHalfPoints > 0) {
    styles.push(`font-size:${formatCssNumber(sizeHalfPoints / 2)}pt`);
  }
  const font = safeFontFamily(attrs.fontAscii ?? attrs.font ?? attrs.csFont);
  if (font) styles.push(`font-family:${font}`);
  const highlight = typeof attrs.highlight === "string" ? HIGHLIGHT_COLORS[attrs.highlight.toLowerCase()] : undefined;
  const shading = hexColor(attrs.shading);
  // Word paints the highlight over the shading when both are set.
  if (highlight) styles.push(`background-color:${highlight}`);
  else if (shading) styles.push(`background-color:#${shading}`);
  if (attrs.vertAlign === "superscript") styles.push("vertical-align:super", "font-size:0.75em");
  else if (attrs.vertAlign === "subscript") styles.push("vertical-align:sub", "font-size:0.75em");
  if (attrs.dstrike === true) styles.push("text-decoration:line-through double");
  const spacingTwips = finiteNumber(attrs.charSpacingTwips);
  if (spacingTwips !== null && spacingTwips !== 0) {
    styles.push(`letter-spacing:${formatCssNumber(spacingTwips / 20)}pt`);
  }
  if (attrs.caps === "all") styles.push("text-transform:uppercase");
  else if (attrs.caps === "small") styles.push("font-variant-caps:small-caps");
  else if (attrs.caps === "none") styles.push("text-transform:none", "font-variant-caps:normal");
  if (attrs.boldOff === true) styles.push("font-weight:normal");
  if (attrs.italicOff === true) styles.push("font-style:normal");
  return styles.length > 0 ? `<span style="${styles.join(";")}">${inner}</span>` : inner;
}

function applyMark(mark: JSONContent, inner: string): string {
  switch (mark.type) {
    case "bold":
      return `<strong>${inner}</strong>`;
    case "italic":
      return `<em>${inner}</em>`;
    case "underline":
      return `<u>${inner}</u>`;
    case "strike":
      return `<s>${inner}</s>`;
    case "ins":
      return `<ins>${inner}</ins>`;
    case "del":
      return `<del>${inner}</del>`;
    case "link": {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href.trim() : "";
      if (!SAFE_LINK_HREF.test(href)) return inner;
      const tooltip = typeof mark.attrs?.tooltip === "string" ? mark.attrs.tooltip : "";
      const title = tooltip.length > 0 ? ` title="${escapeDocxHtmlAttribute(tooltip)}"` : "";
      return `<a href="${escapeDocxHtmlAttribute(href)}"${title}>${inner}</a>`;
    }
    case "docTextStyle":
      return textStyleSpan(mark.attrs ?? {}, inner);
    default:
      // Review/field/comment marks carry no presentation in the exported file.
      return inner;
  }
}

function serializeTextNode(node: JSONContent): string {
  // Apply the strongest mark last so it wraps outermost: Word/genoffice read
  // the run as <strong><em><u><s>> and the fixed nesting is part of the export
  // contract, not an accident of mark order.
  const marks = [...(node.marks ?? [])].sort(
    (left, right) => (MARK_PRIORITY[right.type ?? ""] ?? 90) - (MARK_PRIORITY[left.type ?? ""] ?? 90),
  );
  let html = escapeDocxHtmlText(node.text ?? "");
  for (const mark of marks) html = applyMark(mark, html);
  return html;
}

function serializeInlineImage(node: JSONContent): string {
  const src = typeof node.attrs?.dataUrl === "string" ? node.attrs.dataUrl.trim() : "";
  if (!SAFE_IMAGE_SOURCE.test(src)) return "";
  const width = positiveInt(node.attrs?.widthPx);
  const height = positiveInt(node.attrs?.heightPx);
  const size = width !== null ? ` width="${width}"${height !== null ? ` height="${height}"` : ""}` : "";
  return `<img src="${escapeDocxHtmlAttribute(src)}"${size} alt="">`;
}

export function serializeDocxInline(nodes: readonly JSONContent[] | undefined): string {
  const parts: string[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text") {
      parts.push(serializeTextNode(node));
      continue;
    }
    switch (node.type) {
      case "docHardBreak":
      case "hardBreak":
        parts.push("<br>");
        break;
      case "docInlineImage":
        parts.push(serializeInlineImage(node));
        break;
      case "docInlineMath":
        parts.push(`<span class="docx-math">${escapeDocxHtmlText(String(node.attrs?.text ?? ""))}</span>`);
        break;
      case "docNoteRef":
        parts.push(`<sup class="docx-note-ref">${escapeDocxHtmlText(String(node.attrs?.num ?? ""))}</sup>`);
        break;
      case "docRuby":
        parts.push(
          `<ruby>${escapeDocxHtmlText(String(node.attrs?.base ?? ""))}<rt>${escapeDocxHtmlText(String(node.attrs?.rt ?? ""))}</rt></ruby>`,
        );
        break;
      case "docXeMark":
        // Index entry marker: invisible in Word; nothing to export.
        break;
      default:
        // Unknown inline node: keep its text instead of dropping content.
        parts.push(node.text ? escapeDocxHtmlText(node.text) : serializeDocxInline(node.content));
        break;
    }
  }
  return parts.join("");
}

function paragraphAttributes(node: JSONContent): string {
  const styles: string[] = [];
  const align = node.attrs?.align;
  if (align === "left" || align === "center" || align === "right" || align === "justify") {
    styles.push(`text-align:${align}`);
  }
  if (node.attrs?.pageBreakBefore === true) styles.push("page-break-before:always");
  return styles.length > 0 ? ` style="${styles.join(";")}"` : "";
}

function serializeTable(node: JSONContent): string {
  const rows = (node.content ?? [])
    .filter((row) => row.type === "docTableRow")
    .map((row) => {
      const cells = (row.content ?? [])
        .map((cell) => {
          const tag = cell.type === "docTableHeader" ? "th" : "td";
          return `<${tag}>${serializeBlockNodes(cell.content ?? [])}</${tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case "docParagraph":
      return `<p${paragraphAttributes(node)}>${serializeDocxInline(node.content)}</p>`;
    case "docHeading": {
      const raw = finiteNumber(node.attrs?.level) ?? 1;
      const level = Math.min(Math.max(Math.round(raw), 1), 6);
      return `<h${level}${paragraphAttributes(node)}>${serializeDocxInline(node.content)}</h${level}>`;
    }
    case "docTable":
      return serializeTable(node);
    case "docNestedTable":
    case "docCellBoxes":
      // Display-only placeholder nodes: the nested table model/cell textboxes
      // have no serializable content in the editor document (named gap).
      return "";
    default:
      if (node.content && node.content.length > 0) return serializeBlockNodes(node.content);
      return node.text ? `<p>${escapeDocxHtmlText(node.text)}</p>` : "";
  }
}

type ListKind = "bullet" | "ordered";

interface ListItemNode {
  html: string;
  sub: ListLevel[];
}

interface ListLevel {
  kind: ListKind;
  items: ListItemNode[];
}

/** Consecutive docListItem siblings grouped into ul/ol, nested by ilvl. */
function serializeBlockNodes(nodes: readonly JSONContent[]): string {
  const parts: string[] = [];
  const levels: Array<ListLevel | null> = [];
  const currentItems: Array<ListItemNode | null> = [];

  const renderLevel = (level: ListLevel): string => {
    const tag = level.kind === "ordered" ? "ol" : "ul";
    const items = level.items
      .map((item) => `<li>${item.html}${item.sub.map(renderLevel).join("")}</li>`)
      .join("");
    return `<${tag}>${items}</${tag}>`;
  };

  const closeLevel = (depth: number): void => {
    const level = levels[depth];
    if (!level) return;
    levels[depth] = null;
    currentItems[depth] = null;
    // Nest under the nearest open shallower item; an ilvl jump that skipped a
    // level has no immediate parent, and pushing to `parts` there would put
    // the nested list before its own parent list.
    let parentItem: ListItemNode | null = null;
    for (let parent = depth - 1; parent >= 0 && !parentItem; parent -= 1) parentItem = currentItems[parent] ?? null;
    if (parentItem) parentItem.sub.push(level);
    else parts.push(renderLevel(level));
  };

  const closeAll = (): void => {
    for (let depth = levels.length - 1; depth >= 0; depth -= 1) closeLevel(depth);
    levels.length = 0;
    currentItems.length = 0;
  };

  for (const node of nodes) {
    if (node.type === "docListItem") {
      const kind: ListKind = node.attrs?.kind === "ordered" ? "ordered" : "bullet";
      const rawLevel = finiteNumber(node.attrs?.ilvl) ?? 0;
      const depth = Math.min(Math.max(Math.round(rawLevel), 0), 8);
      // A new item at a shallower depth ends every deeper list first.
      for (let open = levels.length - 1; open > depth; open -= 1) closeLevel(open);
      const existing = levels[depth];
      if (existing && existing.kind !== kind) closeLevel(depth);
      if (!levels[depth]) levels[depth] = { kind, items: [] };
      const item: ListItemNode = { html: serializeDocxInline(node.content), sub: [] };
      levels[depth]!.items.push(item);
      currentItems[depth] = item;
      continue;
    }
    closeAll();
    const block = serializeBlock(node);
    if (block.length > 0) parts.push(block);
  }
  closeAll();
  return parts.join("");
}

const EXPORT_BASE_CSS = [
  "*{box-sizing:border-box}",
  "body{margin:0;padding:24px 16px;background:#fff;color:#111;font-size:11pt;line-height:1.5}",
  "img{max-width:100%;height:auto}",
  "table{border-collapse:collapse;border-spacing:0;margin:0.5em 0}",
  "td,th{padding:0.25em 0.5em;vertical-align:top}",
  "td>p,th>p{margin:0}",
  "ruby rt{font-size:0.6em}",
  "sup,sub{font-size:0.75em}",
  "@media print{body{padding:0;background:none}.docx-export{max-width:none}}",
].join("\n");

/** The complete standalone file: semantic body + embedded styles, no app CSS needed. */
export function docxDocumentToHtml(doc: JSONContent, options: DocxHtmlExportOptions = {}): string {
  const body = serializeBlockNodes(doc.content ?? []);
  const title = (options.title ?? "Document").trim() || "Document";
  const lang = options.lang && SAFE_LANG.test(options.lang) ? ` lang="${escapeDocxHtmlAttribute(options.lang)}"` : "";
  const font = safeFontFamily(options.fontFamily);
  const textColor = safeCssColor(options.textColor);
  // `font` and `textColor` already passed their whitelists, so they can be
  // interpolated into the <style> element without escaping (entities are not
  // decoded there).
  const base = [
    EXPORT_BASE_CSS,
    font ? `body{font-family:${font}}` : null,
    textColor ? `body{color:${textColor}}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");
  const width = positiveInt(options.pageWidthPx);
  const containerStyle = width !== null ? ` style="max-width:${width}px"` : "";
  return [
    "<!DOCTYPE html>",
    `<html${lang}>`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeDocxHtmlText(title)}</title>`,
    "<style>",
    base,
    "</style>",
    "</head>",
    "<body>",
    `<article class="docx-export"${containerStyle}>${body}</article>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
