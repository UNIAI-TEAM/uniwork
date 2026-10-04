import { mayRenderInline } from "../assets/media";
import { normaliseAssetReference } from "../assets/references";
import { BLOCKED_URL } from "../html/preview-copy";
import { findFrontmatter } from "./engine";

// The PREVIEW COPY of a Markdown document: the HTML the isolated iframe
// renders. Markdown is never converted to page JSON here and the source a save
// serialises is untouched - this only builds a throwaway copy for the frame.
//
// The renderer is dependency-free on purpose. The lane's parser
// (@tiptap/markdown's `marked`) is not browser-safe for this boundary
// (scripts/office/check-boundaries.mjs rejects it from the markdown browser
// root), and the preview only needs a documented SUBSET: headings,
// paragraphs, emphasis, code fences and spans, GFM tables, lists, links,
// images, blockquotes and rules. Everything outside that subset (raw HTML
// included) is emitted as ESCAPED TEXT, so the copy is safe by construction.
//
// Safety is not a second scan over a string model of HTML: nothing from the
// source ever becomes markup, so there is no attribute to smuggle a URL into.
// What the renderer does decide is the two URL-bearing slots it emits:
//
//   * link href - a fragment stays; everything else (external, javascript:,
//     data:, a local file) becomes "#", matching the html engine's navigation
//     policy.
//   * image src - a local package reference is kept AS AUTHORED, because the
//     frame's own buildHtmlPreviewCopy pass resolves it against the document
//     manifest and points it at the scoped asset proxy. Resolving it here
//     would produce an absolute proxy URL that the frame's pass (which only
//     maps authored references) would then block. An external, refused or
//     non-renderable inline reference becomes BLOCKED_URL.
//
// BLOCKED_URL is imported from the html engine so the frame's final gate
// recognises the neutralised value as inert rather than dropping the whole
// attribute.

export interface MarkdownPreviewCopyOptions {
  /** Markdown source, frontmatter included (the span is not rendered). */
  source: string;
  /** Package-relative path of the document; decides how a reference is
   * classified. Defaults to "document.md". */
  document_path?: string;
}

const DEFAULT_DOCUMENT_PATH = "document.md";

const FENCE = /^ {0,3}(```+|~~~+)[ \t]*([\w+-]*)[ \t]*$/;
const FENCE_CLOSE = /^ {0,3}(?:```+|~~~+)[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const UL_ITEM = /^ {0,3}[-*+][ \t]+(.*)$/;
const OL_ITEM = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const TARGET = "(<[^>]*>|(?:[^()\\s]|\\([^()\\s]*\\))+)";
const LINK = new RegExp("^\\[([^\\]]*)\\]\\([ \\t]*" + TARGET + "(?:[ \\t]+\"[^\"]*\")?[ \\t]*\\)");
const IMAGE = new RegExp("^!\\[([^\\]]*)\\]\\([ \\t]*" + TARGET + "(?:[ \\t]+\"[^\"]*\")?[ \\t]*\\)");
const AUTOLINK = /^<(https?:\/\/[^>\s]+)>/;

/** Escape the five characters that could become markup in text or a value. */
function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripAngle(token: string): string {
  return token.startsWith("<") && token.endsWith(">") ? token.slice(1, -1) : token;
}

/** A link target: a fragment stays, every other destination is inert. */
function safeHref(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("#") ? trimmed : "#";
}

/** An image target: a local package reference stays authored for the frame's
 * asset pass; a renderable inline data: URI stays; everything else is blocked. */
function safeImageSrc(raw: string, documentPath: string): string {
  const trimmed = raw.trim();
  const reference = normaliseAssetReference(trimmed, documentPath);
  if (reference.kind === "local" || reference.kind === "fragment" || reference.kind === "empty") return trimmed;
  if (reference.kind === "inline" && mayRenderInline(reference.media_type, "image")) return trimmed;
  return BLOCKED_URL;
}

function renderLink(label: string, target: string): string {
  return '<a href="' + esc(safeHref(stripAngle(target))) + '">' + renderInline(label) + "</a>";
}

function renderImage(alt: string, target: string, documentPath: string): string {
  return '<img src="' + esc(safeImageSrc(stripAngle(target), documentPath)) + '" alt="' + esc(alt) + '">';
}

/** Inline spans. Code spans are parsed first so their body is never rescanned;
 * anything unrecognised is escaped as literal text. */
function renderInline(source: string, documentPath: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      out += "<code>" + esc(code[1]!) + "</code>";
      i += code[0].length;
      continue;
    }
    const image = IMAGE.exec(rest);
    if (image) {
      out += renderImage(image[1]!, image[2]!, documentPath);
      i += image[0].length;
      continue;
    }
    const link = LINK.exec(rest);
    if (link) {
      out += renderLink(link[1]!, link[2]!);
      i += link[0].length;
      continue;
    }
    const auto = AUTOLINK.exec(rest);
    if (auto) {
      out += renderLink(auto[1]!, auto[1]!);
      i += auto[0].length;
      continue;
    }
    const strong = /^(\*\*|__)([\s\S]+?)\1/.exec(rest);
    if (strong) {
      out += "<strong>" + renderInline(strong[2]!, documentPath) + "</strong>";
      i += strong[0].length;
      continue;
    }
    const emphasis = /^(\*|_)([^*_]+?)\1/.exec(rest);
    if (emphasis) {
      out += "<em>" + renderInline(emphasis[2]!, documentPath) + "</em>";
      i += emphasis[0].length;
      continue;
    }
    out += esc(source[i]!);
    i += 1;
  }
  return out;
}

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((cell) => cell.trim());
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (header === undefined || delimiter === undefined) return false;
  if (!header.includes("|")) return false;
  return TABLE_DELIMITER.test(delimiter) && delimiter.includes("-");
}

function renderTable(lines: readonly string[], index: number, documentPath: string): { html: string; next: number } {
  const header = splitRow(lines[index]!);
  let cursor = index + 2;
  const rows: string[][] = [];
  while (cursor < lines.length && lines[cursor]!.trim() !== "" && lines[cursor]!.includes("|")) {
    rows.push(splitRow(lines[cursor]!));
    cursor += 1;
  }
  const head = "<thead><tr>" + header.map((cell) => "<th>" + renderInline(cell, documentPath) + "</th>").join("") + "</tr></thead>";
  const body = rows.map((row) => "<tr>" + header.map((_, column) => "<td>" + renderInline(row[column] ?? "", documentPath) + "</td>").join("") + "</tr>").join("");
  return { html: "<table>" + head + "<tbody>" + body + "</tbody></table>", next: cursor };
}

function renderList(lines: readonly string[], index: number, documentPath: string): { html: string; next: number } {
  const ordered = OL_ITEM.test(lines[index]!);
  const start = ordered ? Number(OL_ITEM.exec(lines[index]!)![1]) : 1;
  const items: string[] = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    const match = ordered ? OL_ITEM.exec(line) : UL_ITEM.exec(line);
    if (!match) break;
    let content = (ordered ? match[2] : match[1])!;
    cursor += 1;
    // A lazily continued item: indented lines that are not a new marker.
    while (cursor < lines.length && lines[cursor]!.trim() !== "" && !UL_ITEM.test(lines[cursor]!) && !OL_ITEM.test(lines[cursor]!)) {
      content += " " + lines[cursor]!.trim();
      cursor += 1;
    }
    items.push("<li>" + renderInline(content, documentPath) + "</li>");
  }
  const tag = ordered ? "ol" : "ul";
  const attr = ordered && start !== 1 ? ' start="' + start + '"' : "";
  return { html: "<" + tag + attr + ">" + items.join("") + "</" + tag + ">", next: cursor };
}

function renderBlocks(lines: readonly string[], documentPath: string): string {
  let out = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      const language = fence[2] ? ' class="language-' + esc(fence[2]) + '"' : "";
      out += "<pre><code" + language + ">" + esc(body.join("\n")) + "</code></pre>";
      continue;
    }
    if (RULE.test(line)) {
      out += "<hr>";
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out += "<h" + level + ">" + renderInline(heading[2]!, documentPath) + "</h" + level + ">";
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && (QUOTE.test(lines[i]!) || (quoted.length > 0 && lines[i]!.trim() !== ""))) {
        quoted.push(lines[i]!.replace(QUOTE, ""));
        i += 1;
      }
      out += "<blockquote>" + renderBlocks(quoted, documentPath) + "</blockquote>";
      continue;
    }
    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const list = renderList(lines, i, documentPath);
      out += list.html;
      i = list.next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const table = renderTable(lines, i, documentPath);
      out += table.html;
      i = table.next;
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !FENCE.test(lines[i]!) && !RULE.test(lines[i]!) && !HEADING.test(lines[i]!) && !QUOTE.test(lines[i]!) && !UL_ITEM.test(lines[i]!) && !OL_ITEM.test(lines[i]!) && !isTableStart(lines, i)) {
      paragraph.push(lines[i]!.trim());
      i += 1;
    }
    out += "<p>" + renderInline(paragraph.join(" "), documentPath) + "</p>";
  }
  return out;
}

/**
 * Markdown source -> the HTML the isolated iframe renders. Pure and
 * browser-safe: no Node, Electron or native import, no parser dependency.
 */
export function buildMarkdownPreviewCopy(options: MarkdownPreviewCopyOptions): string {
  const documentPath = options.document_path ?? DEFAULT_DOCUMENT_PATH;
  const frontmatter = findFrontmatter(options.source);
  const body = frontmatter === null ? options.source : options.source.slice(frontmatter.end);
  return renderBlocks(body.split(/\r?\n/), documentPath);
}
