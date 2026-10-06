// UNI-952 (D2/D3-xlsx): the sheet's header and footer, printed in the page
// margin boxes (@page @top-left ... @bottom-right) so they sit in the margin
// on every physical page and `&P` / `&N` are the browser's own page counters.
// Excel's codes: `&L` `&C` `&R` start a section; `&P` page, `&N` pages, `&D`
// date, `&T` time, `&A` sheet name, `&F` file name, `&Z` the document's
// location, `&&` a literal ampersand. Font codes: `&"Name,Style"`, `&nn`
// (size in points), `&B` `&I` `&U` `&E` `&S` (bold, italic, underline,
// double underline, strikethrough toggles) and `&KRRGGBB` (colour). Each
// section starts in the default font, as in Excel.
// A margin box takes ONE style, so a section prints in the font in effect at
// its first printed part; a font change later in the same section, `&X` /
// `&Y` (super/subscript) and theme colours (`&KTTSNNN`) are not printed.
// Pages: `@page` is the odd (and every) page, `@page:left` the even pages
// when `differentOddEven` is set (page 1 is a right page), `@page:first` the
// first page when `differentFirst` is set (declared last, so it wins).
// `&G` (picture) prints nothing. Every literal reaches CSS as an escaped
// string, and every font value passes print-styles' whitelists, so header
// text can neither end the declaration nor the <style> element.
import type { XlsxRenderHeaderFooter } from "@uniwork/office-engine/xlsx";
import { cssColor, cssFontFamily, round } from "./print-styles";

/** The values the field codes print. */
export interface XlsxPrintHeaderContext {
  readonly sheetName: string;
  readonly fileName: string;
  readonly date: string;
  readonly time: string;
  /** Where the host keeps the document (a folder or workspace path), when it
   *  says; `&Z` prints it. Never a local path on web. */
  readonly location?: string | undefined;
}

type Part = { readonly text: string } | { readonly counter: "page" | "pages" };

/** The font one section prints in (absent = the sheet's default). */
interface HeaderFont {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: "none" | "single" | "double";
  readonly strike: boolean;
  readonly size?: number | undefined;
  readonly color?: string | undefined;
  readonly family?: string | undefined;
}

interface Section {
  readonly parts: Part[];
  readonly font: HeaderFont;
}

type Sections = Record<"left" | "center" | "right", Section>;

const PLAIN: HeaderFont = { bold: false, italic: false, underline: "none", strike: false };

/** `&"Name,Style"`: "-" keeps the current name; the style words set bold and
 *  italic ("Regular" clears both). */
function namedFont(font: HeaderFont, spec: string): HeaderFont {
  const comma = spec.indexOf(",");
  const name = (comma === -1 ? spec : spec.slice(0, comma)).trim();
  const style = comma === -1 ? "" : spec.slice(comma + 1).toLowerCase();
  const next = { ...font, ...(name !== "" && name !== "-" ? { family: name } : {}) };
  if (style === "") return next;
  return { ...next, bold: /bold/.test(style), italic: /italic|oblique/.test(style) };
}

/** `&F` printed somewhere in the same string (an `&&F` is a literal "&F"). */
const printsFileName = (source: string): boolean => /(?:^|[^&])(?:&&)*&F/.test(source);

/** Split one header/footer string into its three sections. */
export function parseHeaderFooter(source: string, context: XlsxPrintHeaderContext): Sections {
  const fresh = (): { parts: Part[]; font: HeaderFont; started: HeaderFont | null } => ({ parts: [], font: PLAIN, started: null });
  const state = { left: fresh(), center: fresh(), right: fresh() };
  // Without a location, `&Z` prints the document's name unless `&F` already does.
  const location = context.location ?? (printsFileName(source) ? "" : context.fileName);
  let section: keyof Sections = "center";
  const push = (part: Part): void => {
    const current = state[section];
    current.started ??= current.font;
    const last = current.parts[current.parts.length - 1];
    if ("text" in part && last && "text" in last) current.parts[current.parts.length - 1] = { text: last.text + part.text };
    else current.parts.push(part);
  };
  const setFont = (change: (font: HeaderFont) => HeaderFont): void => {
    state[section].font = change(state[section].font);
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char !== "&") {
      push({ text: char });
      continue;
    }
    const code = source[index + 1];
    index += 1;
    switch (code) {
      case undefined: break;
      case "&": push({ text: "&" }); break;
      case "L": section = "left"; break;
      case "C": section = "center"; break;
      case "R": section = "right"; break;
      case "P": push({ counter: "page" }); break;
      case "N": push({ counter: "pages" }); break;
      case "D": push({ text: context.date }); break;
      case "T": push({ text: context.time }); break;
      case "A": push({ text: context.sheetName }); break;
      case "F": push({ text: context.fileName }); break;
      case "Z": if (location !== "") push({ text: location }); break;
      case "B": setFont((font) => ({ ...font, bold: !font.bold })); break;
      case "I": setFont((font) => ({ ...font, italic: !font.italic })); break;
      case "U": setFont((font) => ({ ...font, underline: font.underline === "single" ? "none" : "single" })); break;
      case "E": setFont((font) => ({ ...font, underline: font.underline === "double" ? "none" : "double" })); break;
      case "S": setFont((font) => ({ ...font, strike: !font.strike })); break;
      case "\"": {
        const close = source.indexOf("\"", index + 1);
        const spec = source.slice(index + 1, close === -1 ? source.length : close);
        index = close === -1 ? source.length : close;
        setFont((font) => namedFont(font, spec));
        break;
      }
      case "K": {
        const color = source.slice(index + 1, index + 7);
        index += 6;
        // A theme colour (`&KTTSNNN`) keeps the current colour.
        if (/^[0-9a-f]{6}$/i.test(color)) setFont((font) => ({ ...font, color }));
        break;
      }
      default: {
        if (/\d/.test(code)) {
          let digits = code;
          while (/\d/.test(source[index + 1] ?? "")) digits += source[(index += 1)];
          const size = Number(digits);
          if (size > 0 && size <= 409) setFont((font) => ({ ...font, size }));
        }
        // Every other letter (`&G`, `&X`, `&Y`, ...) prints nothing.
        break;
      }
    }
  }
  const done = (key: keyof Sections): Section => ({ parts: state[key].parts, font: state[key].started ?? state[key].font });
  return { left: done("left"), center: done("center"), right: done("right") };
}

/** A CSS string literal that cannot break out of its declaration or of the
 *  surrounding <style> element. */
function cssString(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    const unsafe = char === "\\" || char === "\"" || char === "<" || char === ">" || code < 0x20 || code === 0x7f;
    out += unsafe ? `\\${code.toString(16)} ` : char;
  }
  return `"${out}"`;
}

function content(parts: readonly Part[]): string {
  if (parts.length === 0) return "none";
  return parts.map((part) => ("text" in part ? cssString(part.text) : `counter(${part.counter})`)).join(" ");
}

/** The declarations a section's font adds to its margin box. */
function fontDeclarations(font: HeaderFont, scale: number): string {
  const out: string[] = [];
  const family = font.family === undefined ? null : cssFontFamily(font.family);
  if (family) out.push(`font-family:${family}`);
  if (font.size !== undefined) out.push(`font-size:${round(font.size * scale)}pt`);
  if (font.bold) out.push("font-weight:700");
  if (font.italic) out.push("font-style:italic");
  const lines = [font.underline === "none" ? "" : "underline", font.strike ? "line-through" : ""].filter(Boolean);
  if (lines.length > 0) out.push(`text-decoration:${lines.join(" ")}${font.underline === "double" ? " double" : ""}`);
  const color = cssColor(font.color);
  if (color) out.push(`color:${color}`);
  return out.map((declaration) => `;${declaration}`).join("");
}

const SECTIONS = ["left", "center", "right"] as const;

function boxes(edge: "top" | "bottom", sections: Sections | null, style: string, scale: number): string {
  return SECTIONS
    .map((key) => {
      const section = sections?.[key];
      return `@${edge}-${key}{content:${section ? content(section.parts) : "none"};${style}${section ? fontDeclarations(section.font, scale) : ""}}`;
    })
    .join("");
}

interface XlsxHeaderGeometry {
  /** Header / footer distance from the paper edge, in inches. */
  readonly header: number;
  readonly footer: number;
  /** The print scale (fonts scale with the sheet, Excel's default). */
  readonly scale: number;
  readonly fontFamily: string;
}

/** Excel's header/footer font size when the string names none. */
const DEFAULT_SIZE = 11;

/** The @page margin-box rules for the sheet's header and footer (empty when
 *  the file has none). */
export function headerFooterRules(
  headerFooter: XlsxRenderHeaderFooter | null,
  context: XlsxPrintHeaderContext,
  geometry: XlsxHeaderGeometry,
): string[] {
  if (!headerFooter) return [];
  const parse = (text: string | undefined): Sections | null => (text ? parseHeaderFooter(text, context) : null);
  const common = `font-family:${geometry.fontFamily};font-size:${round(DEFAULT_SIZE * geometry.scale)}pt;color:#000000;white-space:pre`;
  const top = `${common};vertical-align:top;padding-top:${round(geometry.header)}in`;
  const bottom = `${common};vertical-align:bottom;padding-bottom:${round(geometry.footer)}in`;
  const rule = (selector: string, header: string | undefined, footer: string | undefined): string =>
    `@page${selector}{${boxes("top", parse(header), top, geometry.scale)}${boxes("bottom", parse(footer), bottom, geometry.scale)}}`;
  const rules: string[] = [];
  if (headerFooter.oddHeader || headerFooter.oddFooter) rules.push(rule("", headerFooter.oddHeader, headerFooter.oddFooter));
  if (headerFooter.differentOddEven) rules.push(rule(":left", headerFooter.evenHeader, headerFooter.evenFooter));
  if (headerFooter.differentFirst) rules.push(rule(":first", headerFooter.firstHeader, headerFooter.firstFooter));
  return rules;
}
