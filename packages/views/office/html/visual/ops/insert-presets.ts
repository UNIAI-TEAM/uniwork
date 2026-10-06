// Markup presets for the HTML insert ribbon. genoffice's insert-presets
// module (pinned 09485f88) turns a ribbon choice into the snippet that gets
// inserted; UniWork keeps the markup behaviour only - no styles, no theme, no
// genoffice CSS classes. Every builder returns a string a caller passes to
// `insert_html` / `replace_element`, so the source is only ever changed
// through the engine's patch path.

/** Heading level a ribbon "heading" preset inserts. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Inline style attributes are never emitted: the inserted markup inherits the
 * document's own CSS, exactly as the author wrote the rest of the file. */
export interface TextPresetOptions {
  text?: string;
}

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escape text for an element body (the author's text, never markup). */
export function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ESCAPES[ch]!);
}

export function headingPreset(level: HeadingLevel, options: TextPresetOptions = {}): string {
  return "<h" + level + ">" + escapeHtmlText(options.text ?? "") + "</h" + level + ">";
}

export function paragraphPreset(options: TextPresetOptions = {}): string {
  return "<p>" + escapeHtmlText(options.text ?? "") + "</p>";
}

export function blockquotePreset(options: TextPresetOptions = {}): string {
  return "<blockquote>" + escapeHtmlText(options.text ?? "") + "</blockquote>";
}

export function listPreset(kind: "unordered" | "ordered", items: readonly string[] = []): string {
  const tag = kind === "ordered" ? "ol" : "ul";
  const body = items.map((item) => "<li>" + escapeHtmlText(item) + "</li>").join("");
  return "<" + tag + ">" + body + "</" + tag + ">";
}

export function sectionPreset(options: { className?: string; id?: string; inner?: string } = {}): string {
  let attrs = "";
  if (options.id !== undefined) attrs += ' id="' + escapeHtmlText(options.id) + '"';
  if (options.className !== undefined) attrs += ' class="' + escapeHtmlText(options.className) + '"';
  return "<section" + attrs + ">" + (options.inner ?? "") + "</section>";
}

export function buttonPreset(options: { label?: string; href?: string; type?: "button" | "submit" } = {}): string {
  if (options.href !== undefined) {
    return '<a href="' + escapeHtmlText(options.href) + '">' + escapeHtmlText(options.label ?? "") + "</a>";
  }
  const type = options.type ?? "button";
  return '<button type="' + type + '">' + escapeHtmlText(options.label ?? "") + "</button>";
}

export function imagePreset(options: { src: string; alt?: string; width?: number }): string {
  let attrs = ' src="' + escapeHtmlText(options.src) + '"';
  if (options.alt !== undefined) attrs += ' alt="' + escapeHtmlText(options.alt) + '"';
  if (typeof options.width === "number") attrs += ' width="' + options.width + '"';
  return "<img" + attrs + ">";
}

export function horizontalRulePreset(): string {
  return "<hr>";
}

export interface TablePresetOptions {
  rows: number;
  columns: number;
  /** Emit a <thead> with the first row as header cells. */
  header?: boolean;
  /** Optional cell text, row-major. Missing cells render empty. */
  cells?: readonly (readonly string[])[];
}

/** A table of `rows` x `columns`. `rows` counts body rows; a header adds one
 * more. Dimensions are clamped to sane bounds so a bad ribbon value cannot
 * emit an unbounded snippet. */
export function tablePreset(options: TablePresetOptions): string {
  const columns = Math.max(1, Math.min(50, Math.trunc(options.columns)));
  const rows = Math.max(1, Math.min(200, Math.trunc(options.rows)));
  const cell = (tag: "th" | "td", value: string | undefined): string =>
    "<" + tag + ">" + escapeHtmlText(value ?? "") + "</" + tag + ">";
  const row = (tag: "th" | "td", index: number): string => {
    const source = options.cells?.[index];
    let out = "<tr>";
    for (let c = 0; c < columns; c += 1) out += cell(tag, source?.[c]);
    return out + "</tr>";
  };
  let body = "";
  let offset = 0;
  if (options.header) {
    body += "<thead>" + row("th", 0) + "</thead>";
    offset = 1;
  }
  body += "<tbody>";
  for (let r = 0; r < rows; r += 1) body += row("td", r + offset);
  body += "</tbody>";
  return "<table>" + body + "</table>";
}

/** The ribbon's heading choices, in order. */
export const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];
