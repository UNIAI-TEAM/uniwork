import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * Font families offered by the Home tab picker, ported from the genoffice
 * renderer's font list (apps/docs/src/renderer/font-list.ts): Latin families
 * first for the default locale, then the script groups a Vietnamese or
 * East-Asian author is most likely to reach for. The picker accepts a typed
 * name too, so this list is a convenience, not a whitelist.
 */
const LATIN = [
  "Calibri",
  "Arial",
  "Times New Roman",
  "Georgia",
  "Verdana",
  "Tahoma",
  "Cambria",
  "Garamond",
  "Trebuchet MS",
  "Segoe UI",
  "Courier New",
  "Impact",
];

const SIMPLIFIED_CHINESE = [
  "等线",
  "宋体",
  "黑体",
  "微软雅黑",
  "楷体",
  "仿宋",
  "仿宋_GB2312",
  "楷体_GB2312",
  "方正小标宋简体",
];

const JAPANESE = ["Yu Gothic", "Yu Mincho", "Meiryo", "MS Gothic", "MS Mincho"];

const KOREAN = ["Malgun Gothic", "Batang", "Gulim", "Dotum"];

const TRADITIONAL_CHINESE = ["Microsoft JhengHei", "PMingLiU"];

export const BUILTIN_FONT_FAMILIES: readonly string[] = [
  ...LATIN,
  ...JAPANESE,
  ...SIMPLIFIED_CHINESE,
  ...KOREAN,
  ...TRADITIONAL_CHINESE,
];

const EAST_ASIAN_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const EAST_ASIAN_ROMANIZED_RE =
  /simsun|nsimsun|kaiti|fangsong|dengxian|yahei|songti|heiti|pingfang|hiragino|meiryo|osaka|yugoth|yu ?(gothic|mincho)|ms ?(ui )?(gothic|mincho)|malgun|batang|gulim|dotum|nanum|jhenghei|mingliu|biaukai|source han|noto (sans|serif) (cjk|sc|tc|hk|jp|kr)/i;

/**
 * Which rFonts slot a pick targets: an East-Asian face goes to w:eastAsia,
 * everything else to w:ascii/w:hAnsi — Word never flattens the other slot.
 */
export function isEastAsianFontName(name: string): boolean {
  const normalized = name.normalize("NFKC");
  return EAST_ASIAN_SCRIPT_RE.test(normalized) || EAST_ASIAN_ROMANIZED_RE.test(normalized);
}

/** True when the sample text needs the East-Asian slot of a dual-font run. */
export function textHasCjk(text: string): boolean {
  return EAST_ASIAN_SCRIPT_RE.test(text);
}

/**
 * Every explicit run font the document declares, in first-seen order. The
 * parsed docDefaults/styles live outside the toolbar context, so this walks
 * the live document (the same places collectDocFonts reads) instead.
 */
export function collectDocumentFonts(doc: PmNode): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    const name = value.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };
  doc.descendants((node) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== "docTextStyle") continue;
      add(mark.attrs.font);
      add(mark.attrs.fontAscii);
    }
    return true;
  });
  return names;
}
