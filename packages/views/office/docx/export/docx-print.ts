// UNI-952 (E-docx): print for the open DOCX document as a DOCUMENT COPY.
//
// Printing never touches the app window: the document model (the editor's
// JSON, the same model the HTML export walks) is serialized into a
// self-contained, script-free HTML document whose page geometry comes from
// the DOCX sections, and that copy is handed to the INJECTED print port
// (browser: an isolated hidden frame; desktop: the host's own hidden window).
// So page 1 of the job is the document's first page and no app chrome
// (ribbon, header, panels) can reach the paper.
//
// The copy is built from escaped text and generated markup only (see
// ./docx-html-export), then passed through the shared print sanitizer, whose
// CSP allows `data:` images alone. Images that are not inline `data:image`
// sources are dropped from the copy rather than left as blocked links.
//
// Geometry: every distinct paper (size + margins; orientation is the paper box
// itself) gets a named @page, the section's blocks are paginated with
// `page: <name>` and a non-continuous section starts a new sheet (odd/even
// page starts map to right/left). Sections on the same paper share one name,
// because a changed `page` value forces a sheet break by itself. Word page breaks and
// "page break before" paragraphs force breaks. Headers and footers are resolved
// per section (./docx-print-header-footer) and print through each named page's
// margin boxes, pictures included (each picture defined once on :root); the
// page name is keyed by the printed header/footer as well as the paper, so a
// section that starts a sheet with other parts gets its own page, while a
// continuous section on the same paper always flows on, as in Word.

import type { JSONContent } from "@tiptap/core";
import { sanitizePrintCopy } from "../../markdown/wysiwyg/print";
import type { OfficePrintOutcome, OfficePrintPort } from "../../print";
import { sectionIndexAtDocxIndex, type DocxPageSetupSection } from "../page-setup/docx-page-setup";
import { escapeDocxHtmlText, serializeBlockNodes } from "./docx-html-export";
import {
  headerFooterPageRules,
  printedHfKey,
  sectionHeaderFooter,
  type DocxPrintHeaderFooter,
  type DocxPrintSectionHf,
} from "./docx-print-header-footer";
import { DocxPrintHfImageDefs } from "./docx-print-hf-image";

/** The page setup the copy uses when the document reports no section: A4, 2.54 cm margins. */
const DEFAULT_SECTION: DocxPageSetupSection = {
  index: 0,
  firstBlockIndex: 0,
  lastBlockIndex: Number.MAX_SAFE_INTEGER,
  pageWidth: 11906,
  pageHeight: 16838,
  orientation: "portrait",
  marginTop: 1440,
  marginRight: 1440,
  marginBottom: 1440,
  marginLeft: 1440,
  columns: 1,
  columnSpace: 720,
  startType: "nextPage",
};

const SAFE_LANG = /^[A-Za-z0-9-]+$/;
const SAFE_FONT_FAMILY = /^[\p{L}\p{N}\s,'".()-]+$/u;
const SAFE_CSS_COLOR = /^(?:#[0-9A-Fa-f]{3,8}|rgba?\([\d\s.,%/]+\))$/;
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+[;,]/i;

export interface DocxPrintCopyInput {
  /** The editor's JSON document. */
  doc: JSONContent;
  /** Printed page title (the document name). */
  title: string;
  /** The document's sections with pending page-setup edits applied; empty or absent = A4 default. */
  sections?: readonly DocxPageSetupSection[] | null;
  /** The per-section header/footer parts (resolveDocxPrintHeaderFooter); absent = none printed. */
  headerFooter?: DocxPrintHeaderFooter | null;
  lang?: string;
  fontFamily?: string;
  textColor?: string;
}

/** 1440 twips per inch over 96 CSS px per inch. */
const TWIPS_PER_PX = 15;

function pt(twips: number): string {
  const value = Math.max(0, twips) / 20;
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}pt`;
}

/** Sections that print on the same paper (size + the four margins) share one page name. */
function pageGeometryKey(section: DocxPageSetupSection): string {
  return [section.pageWidth, section.pageHeight, section.marginTop, section.marginRight, section.marginBottom, section.marginLeft].join(":");
}

interface NamedPages {
  /** The page name of each run, by run ordinal. */
  names: string[];
  /** One entry per distinct geometry + printed header/footer, in first-use order. */
  pages: { name: string; section: DocxPageSetupSection; hf: DocxPrintSectionHf | null }[];
}

/**
 * CSS Paged Media starts a new sheet whenever the `page` value changes between
 * siblings, so a continuous section can only flow on when it keeps the name of
 * the section before it. A continuous section on the same paper therefore
 * always keeps the previous name, even when its header/footer differs: Word
 * applies a continuous section's own header and footer from the NEXT page and
 * never breaks the sheet for it, and the editor's paginator does not break
 * either (upstream sectionGeoms). A named page cannot change header mid-flow,
 * so that section's own parts print from the next section that starts a sheet.
 * Every other section is named by what its page prints (geometry plus the
 * header/footer parts by content), not by section.
 */
function namePages(runs: readonly SectionRun[], headerFooter: DocxPrintHeaderFooter | null | undefined): NamedPages {
  const byKey = new Map<string, string>();
  const pages: NamedPages["pages"] = [];
  const evenAndOdd = headerFooter?.evenAndOddHeaders === true;
  const names: string[] = [];
  runs.forEach((run, ordinal) => {
    const previous = ordinal > 0 ? runs[ordinal - 1] : undefined;
    const carried = names[ordinal - 1];
    if (previous && carried !== undefined && breakBefore(run.section) === "auto" && pageGeometryKey(run.section) === pageGeometryKey(previous.section)) {
      names.push(carried);
      return;
    }
    const hf = sectionHeaderFooter(headerFooter, run.section.index);
    const key = `${pageGeometryKey(run.section)}|${printedHfKey(hf, evenAndOdd)}`;
    let name = byKey.get(key);
    if (name === undefined) {
      name = `docx-s${pages.length}`;
      byKey.set(key, name);
      pages.push({ name, section: run.section, hf });
    }
    names.push(name);
  });
  return { names, pages };
}

/** Drops inline images whose source is not an inline data:image (the copy's CSP would block them anyway). */
function printableNodes(nodes: readonly JSONContent[] | undefined): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "docInlineImage") {
      const src = typeof node.attrs?.dataUrl === "string" ? node.attrs.dataUrl.trim() : "";
      if (!DATA_IMAGE.test(src)) continue;
    }
    out.push(node.content ? { ...node, content: printableNodes(node.content) } : node);
  }
  return out;
}

/**
 * The sections in print order, merged the way the paginator merges them
 * (upstream liveSections): a non-final section whose closing break paragraph
 * was deleted from the document flows into the next section's page setup.
 */
function liveSectionsOf(sections: readonly DocxPageSetupSection[], blocks: readonly JSONContent[]): DocxPageSetupSection[] {
  if (sections.length <= 1) return sections.length === 1 ? [...sections] : [DEFAULT_SECTION];
  const present = new Set<number>();
  for (const block of blocks) {
    const docxIndex = block.attrs?.docxIndex as unknown;
    if (typeof docxIndex === "number") present.add(docxIndex);
  }
  const out: DocxPageSetupSection[] = [];
  let carryFirst: number | null = null;
  sections.forEach((section, at) => {
    const first = carryFirst ?? section.firstBlockIndex;
    carryFirst = null;
    if (at < sections.length - 1 && !present.has(section.lastBlockIndex)) {
      carryFirst = first;
      return;
    }
    out.push({ ...section, firstBlockIndex: first });
  });
  return out;
}

interface SectionRun {
  section: DocxPageSetupSection;
  blocks: JSONContent[];
}

/** Top-level blocks grouped by owning section; a block without a docxIndex (editor-created) stays with the previous one. */
function sectionRuns(sections: readonly DocxPageSetupSection[], blocks: readonly JSONContent[]): SectionRun[] {
  const runs: SectionRun[] = [];
  let current = 0;
  for (const block of blocks) {
    const docxIndex = block.attrs?.docxIndex as unknown;
    if (typeof docxIndex === "number") {
      const ordinal = sections.findIndex((section) => section.index === sectionIndexAtDocxIndex(sections, docxIndex));
      current = ordinal >= 0 ? ordinal : current;
    }
    const last = runs[runs.length - 1];
    if (last && last.section === sections[current]) last.blocks.push(block);
    else runs.push({ section: sections[current] ?? DEFAULT_SECTION, blocks: [block] });
  }
  return runs.length > 0 ? runs : [{ section: sections[0] ?? DEFAULT_SECTION, blocks: [] }];
}

/** `@page` with an optional selector (a page name, `:first`, `:left`). */
function pageAt(selector: string): string {
  return selector ? `@page ${selector}` : "@page";
}

function pageRule(selector: string, section: DocxPageSetupSection): string {
  return [
    `${pageAt(selector)} {`,
    `  size: ${pt(section.pageWidth)} ${pt(section.pageHeight)};`,
    `  margin: ${pt(section.marginTop)} ${pt(section.marginRight)} ${pt(section.marginBottom)} ${pt(section.marginLeft)};`,
    "}",
  ].join("\n");
}

function breakBefore(section: DocxPageSetupSection): string {
  switch (section.startType) {
    case "continuous":
    case "nextColumn":
      return "auto";
    case "oddPage":
      return "right";
    case "evenPage":
      return "left";
    default:
      return "page";
  }
}

function sectionStyle(run: SectionRun, name: string, previous: DocxPageSetupSection | null): string {
  const styles = [`page:${name}`];
  // A page name that differs from the previous section's already breaks; a same-geometry continuous section flows on.
  if (previous) styles.push(`break-before:${breakBefore(run.section)}`);
  if (run.section.columns > 1) {
    styles.push(`column-count:${run.section.columns}`, `column-gap:${pt(run.section.columnSpace)}`);
  }
  return styles.join(";");
}

const PRINT_BASE_CSS = [
  "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
  "html,body{margin:0;padding:0;background:#fff}",
  "body{color:#111;font-size:11pt;line-height:1.15}",
  "p,h1,h2,h3,h4,h5,h6{margin:0 0 8pt}",
  "img{max-width:100%;height:auto}",
  "table{border-collapse:collapse;border-spacing:0;margin:0 0 8pt;max-width:100%}",
  "td,th{padding:2pt 5pt;vertical-align:top;border:0.5pt solid #bfbfbf}",
  "td>p,th>p{margin:0}",
  "tr,img{break-inside:avoid}",
  "ruby rt{font-size:0.6em}",
  "sup,sub{font-size:0.75em}",
  ".docx-page-break{display:block;break-after:page}",
].join("\n");

function safeFont(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || !SAFE_FONT_FAMILY.test(trimmed)) return null;
  const families = trimmed.split(",").map((family) => family.replace(/['"]/g, "").trim()).filter(Boolean);
  return families.length > 0 ? families.map((family) => `'${family}'`).join(", ") : null;
}

/**
 * The print document BEFORE sanitizing: generated markup only. Exported for
 * the copy tests; callers print through {@link docxPrintCopy}.
 */
export function buildDocxPrintHtml(input: DocxPrintCopyInput): string {
  const blocks = printableNodes(input.doc.content);
  const sections = liveSectionsOf(input.sections ?? [], blocks);
  const runs = sectionRuns(sections, blocks);
  const first = runs[0]?.section ?? DEFAULT_SECTION;
  const named = namePages(runs, input.headerFooter);
  const evenAndOdd = input.headerFooter?.evenAndOddHeaders === true;
  const images = new DocxPrintHfImageDefs();
  const pages = [
    pageRule("", first),
    ...named.pages.flatMap((page) => [
      pageRule(page.name, page.section),
      ...headerFooterPageRules(page.name, page.hf, evenAndOdd, page.name === named.names[0], {
        images,
        marginTopPx: page.section.marginTop / TWIPS_PER_PX,
        marginBottomPx: page.section.marginBottom / TWIPS_PER_PX,
      }),
    ]),
  ];
  const font = safeFont(input.fontFamily);
  const color = input.textColor && SAFE_CSS_COLOR.test(input.textColor.trim()) ? input.textColor.trim() : null;
  const css = [
    PRINT_BASE_CSS,
    font ? `body{font-family:${font}}` : null,
    color ? `body{color:${color}}` : null,
    images.rootRule(),
    ...pages,
  ].filter((part): part is string => part !== null);
  const body = runs
    .map((run, ordinal) => {
      const previous = ordinal > 0 ? (runs[ordinal - 1]?.section ?? null) : null;
      return `<section class="docx-print-section" style="${sectionStyle(run, named.names[ordinal] ?? "docx-s0", previous)}">${serializeBlockNodes(run.blocks)}</section>`;
    })
    .join("\n");
  const lang = input.lang && SAFE_LANG.test(input.lang) ? ` lang="${input.lang}"` : "";
  const title = input.title.trim() || "Document";
  return [
    "<!DOCTYPE html>",
    `<html${lang}>`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeDocxHtmlText(title)}</title>`,
    `<style>\n${css.join("\n")}\n</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** The sanitized, script-free print copy a port receives. */
export function docxPrintCopy(input: DocxPrintCopyInput): string {
  return sanitizePrintCopy(buildDocxPrintHtml(input));
}

interface DocxPrintActionOptions {
  port: OfficePrintPort;
  /** Builds the copy from the CURRENT document; null when no document is open. */
  buildCopy(): string | null;
  title: string;
}

/**
 * The one print action every DOCX entry calls: build the copy, hand it to the
 * port, return the port's outcome. A copy that cannot be built or a port that
 * throws becomes a typed failure, never a crash in the menu; no retry.
 */
export async function printDocxDocument(options: DocxPrintActionOptions): Promise<OfficePrintOutcome> {
  try {
    const html = options.buildCopy();
    if (html === null) return { outcome: "failed", reason: "no_document" };
    return await options.port.print({ html, title: options.title });
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
