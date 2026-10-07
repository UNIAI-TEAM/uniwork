/**
 * Page geometry read back from a print copy (UNI-952). Every Office copy
 * states its first sheet in an unnamed `@page { size: ... }` rule (DOCX: the
 * first section; XLSX: the sheet's setup; PPTX: the slide box; PDF: page 1;
 * Markdown/HTML: A4 or the file's own rule). Reading it back is how a request
 * carries the SAME geometry the copy lays out, so the desktop dialog never
 * opens portrait for a landscape copy.
 */
import type { OfficePrintPage } from "./index";

const MM_PER_UNIT: Readonly<Record<string, number>> = {
  mm: 1,
  cm: 10,
  q: 0.25,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  px: 25.4 / 96,
};

/** CSS named page sizes, portrait, in millimetres (CSS Paged Media 3). */
const NAMED_SIZES_MM: Readonly<Record<string, readonly [number, number]>> = {
  a5: [148, 210],
  a4: [210, 297],
  a3: [297, 420],
  b5: [176, 250],
  b4: [250, 353],
  "jis-b5": [182, 257],
  "jis-b4": [257, 364],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  ledger: [279.4, 431.8],
};

/** CSS comments and quoted strings: an `@page` inside one is not a rule. */
const CSS_COMMENT_OR_STRING = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
/** The head of a plain `@page` rule, named or not. A pseudo-class (`@page :first`)
 * never matches: those rules carry margin boxes, not a size. */
const PAGE_RULE_HEAD = /@page(?:\s+([\w-]+))?\s*\{/gi;
/** The copy's comments and `<style>` elements in document order: only a
 * style's text (group 1) can hold the rule, a commented-out one never does. */
const COMMENT_OR_STYLE = /<!--[\s\S]*?-->|<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const SIZE_DECLARATION = /(?:^|;)\s*size\s*:\s*([^;!]+)/i;
const LENGTH = /^(\d+(?:\.\d+)?|\.\d+)(mm|cm|q|in|pt|pc|px)$/i;

function lengthMm(token: string): number | undefined {
  const match = LENGTH.exec(token);
  if (!match) return undefined;
  const value = Number(match[1]) * MM_PER_UNIT[match[2]!.toLowerCase()]!;
  return value > 0 && Number.isFinite(value) ? value : undefined;
}

/** The page a CSS `size` value describes (an orientation alone reads as A4
 * in that orientation), or undefined for `auto` or anything unknown. */
function pageFromCssSize(value: string): OfficePrintPage | undefined {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const orientation = tokens.find((token) => token === "landscape" || token === "portrait");
  const rest = tokens.filter((token) => token !== orientation);
  let width: number | undefined;
  let height: number | undefined;
  if (rest.length === 0 && orientation) {
    // An orientation alone leaves the paper to the host; A4 is the host default.
    [width, height] = NAMED_SIZES_MM.a4!;
  } else if (rest.length === 1 && NAMED_SIZES_MM[rest[0]!]) {
    [width, height] = NAMED_SIZES_MM[rest[0]!]!;
  } else if (!orientation && (rest.length === 1 || rest.length === 2)) {
    width = lengthMm(rest[0]!);
    height = rest.length === 2 ? lengthMm(rest[1]!) : width;
  }
  if (width === undefined || height === undefined) return undefined;
  if (orientation === "landscape" && width < height) [width, height] = [height, width];
  if (orientation === "portrait" && width > height) [width, height] = [height, width];
  return { widthMm: width, heightMm: height, landscape: width > height };
}

/** A plain page rule: its name (undefined when unnamed) and its own declarations. */
type PageRule = { name: string | undefined; declarations: string };

/**
 * Every plain `@page` rule in `css`, in order. A rule may nest margin boxes
 * (`@page { size: A4; @top-left { ... } }`): braces are balanced and only the
 * rule's own declarations are returned, so a `size` inside a margin box is never
 * read as the page's. A rule that never closes ends the scan.
 */
function pageRules(css: string): PageRule[] {
  const rules: PageRule[] = [];
  PAGE_RULE_HEAD.lastIndex = 0;
  for (let head = PAGE_RULE_HEAD.exec(css); head; head = PAGE_RULE_HEAD.exec(css)) {
    let depth = 1;
    let declarations = "";
    let index = PAGE_RULE_HEAD.lastIndex;
    for (; index < css.length && depth > 0; index += 1) {
      const char = css[index]!;
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (depth === 1) declarations += char;
    }
    if (depth > 0) break;
    rules.push({ name: head[1], declarations });
    PAGE_RULE_HEAD.lastIndex = index;
  }
  return rules;
}

/** What a copy lays out: every page it states is portrait, every one is
 * landscape, or the copy mixes both. */
export type OfficePrintOrientation = "portrait" | "landscape" | "mixed";

/**
 * The orientations the copy prints across ALL its page rules (unnamed and
 * named: a DOCX with a portrait and a landscape section, a PDF with mixed page
 * sizes). Read in place like {@link printPageFromCopy}, never parsed into a DOM.
 * Undefined when no rule states a usable size.
 */
export function printOrientationFromCopy(html: string): OfficePrintOrientation | undefined {
  let landscape = false;
  let portrait = false;
  for (const match of html.matchAll(COMMENT_OR_STYLE)) {
    if (match[1] === undefined) continue;
    const css = match[1].replace(CSS_COMMENT_OR_STRING, "");
    for (const rule of pageRules(css)) {
      const size = SIZE_DECLARATION.exec(rule.declarations);
      const page = size ? pageFromCssSize(size[1]!) : undefined;
      if (!page) continue;
      if (page.landscape) landscape = true;
      else portrait = true;
    }
  }
  if (landscape && portrait) return "mixed";
  return landscape ? "landscape" : portrait ? "portrait" : undefined;
}

/**
 * The first sheet of a print copy, from its first unnamed `@page` rule.
 * Undefined when the copy has none or states no usable size: the host then
 * keeps its own default (A4 portrait on desktop).
 */
export function printPageFromCopy(html: string): OfficePrintPage | undefined {
  // The copy can be 16 MiB of base64 images: it is scanned in place for its
  // style text, never parsed into a DOM (once per run on every host).
  for (const match of html.matchAll(COMMENT_OR_STYLE)) {
    if (match[1] === undefined) continue;
    const css = match[1].replace(CSS_COMMENT_OR_STRING, "");
    for (const rule of pageRules(css)) {
      if (rule.name !== undefined) continue;
      // A rule that only nests margin boxes states no size: the next one may.
      const size = SIZE_DECLARATION.exec(rule.declarations);
      if (size) return pageFromCssSize(size[1]!);
    }
  }
  return undefined;
}
