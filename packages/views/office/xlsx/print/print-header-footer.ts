// UNI-952 (D2-xlsx): the sheet's header and footer, printed in the page
// margin boxes (@page @top-left ... @bottom-right) so they sit in the margin
// on every physical page and `&P` / `&N` are the browser's own page counters.
// Excel's codes: `&L` `&C` `&R` start a section; `&P` page, `&N` pages, `&D`
// date, `&T` time, `&A` sheet name, `&F` file name, `&&` a literal ampersand.
// Font codes (`&"Name,Style"`, `&12`, `&B`, `&I`, `&U`, `&E`, `&S`, `&X`,
// `&Y`, `&KRRGGBB`) are dropped; `&Z` (path) and `&G` (picture) print
// nothing. Every literal reaches CSS as an escaped string, so header text can
// neither end the declaration nor the <style> element.
import type { XlsxRenderHeaderFooter } from "@uniwork/office-engine/xlsx";
import { round } from "./print-styles";

/** The values the field codes print. */
export interface XlsxPrintHeaderContext {
  readonly sheetName: string;
  readonly fileName: string;
  readonly date: string;
  readonly time: string;
}

type Part = { readonly text: string } | { readonly counter: "page" | "pages" };
type Sections = Record<"left" | "center" | "right", Part[]>;

/** Split one header/footer string into its three sections of parts. */
export function parseHeaderFooter(source: string, context: XlsxPrintHeaderContext): Sections {
  const sections: Sections = { left: [], center: [], right: [] };
  let section: keyof Sections = "center";
  const push = (part: Part): void => {
    const parts = sections[section];
    const last = parts[parts.length - 1];
    if ("text" in part && last && "text" in last) parts[parts.length - 1] = { text: last.text + part.text };
    else parts.push(part);
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
      case "\"": {
        const close = source.indexOf("\"", index + 1);
        index = close === -1 ? source.length : close;
        break;
      }
      case "K": index += 6; break;
      default:
        // Font size digits; every other letter is a font toggle or a field
        // this copy does not print.
        while (/\d/.test(source[index + 1] ?? "")) index += 1;
        break;
    }
  }
  return sections;
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

const SECTIONS = ["left", "center", "right"] as const;

function boxes(edge: "top" | "bottom", sections: Sections | null, style: string): string {
  return SECTIONS
    .map((key) => `@${edge}-${key}{content:${sections ? content(sections[key]) : "none"};${style}}`)
    .join("");
}

/** The @page margin-box rules for the sheet's header and footer (empty when
 *  the file has none). Distances are inches from the paper edge. */
export function headerFooterRules(
  headerFooter: XlsxRenderHeaderFooter | null,
  context: XlsxPrintHeaderContext,
  geometry: { readonly header: number; readonly footer: number; readonly fontSize: number; readonly fontFamily: string },
): string[] {
  if (!headerFooter) return [];
  const parse = (text: string | undefined): Sections | null => (text ? parseHeaderFooter(text, context) : null);
  const common = `font-family:${geometry.fontFamily};font-size:${round(geometry.fontSize)}pt;color:#000000;white-space:pre`;
  const top = `${common};vertical-align:top;padding-top:${round(geometry.header)}in`;
  const bottom = `${common};vertical-align:bottom;padding-bottom:${round(geometry.footer)}in`;
  const rules: string[] = [];
  const odd = { header: parse(headerFooter.oddHeader), footer: parse(headerFooter.oddFooter) };
  if (odd.header || odd.footer) rules.push(`@page{${boxes("top", odd.header, top)}${boxes("bottom", odd.footer, bottom)}}`);
  if (headerFooter.differentFirst) {
    const first = { header: parse(headerFooter.firstHeader), footer: parse(headerFooter.firstFooter) };
    rules.push(`@page:first{${boxes("top", first.header, top)}${boxes("bottom", first.footer, bottom)}}`);
  }
  return rules;
}
