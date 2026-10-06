// Pure XML transforms for slide master / layout part edits the vendored
// pptx-ops cannot express (UNI-939 T01, B6): no registered op opts in to
// `allowPart` for a part name, a new placeholder shape or a text style
// (registry.ts:243-262; only setText/setTransform/setFill/setStroke/
// deleteElement do). Each function takes the part's XML text and returns the
// rewritten text, or throws a PptxEngineError; it touches nothing else, so the
// same input always yields the same output (undo = reopen + journal replay).
import { PptxEngineError } from "../engine";

/** A placeholder slot as `<p:ph type idx>` names it; `idx` is absent on a title. */
export interface MasterPlaceholderRef {
  type: string;
  idx?: number;
}

interface MasterPlaceholderGeometry {
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
}

/** Level text style patch; every field is optional but at least one is set. */
export interface MasterTextStylePatch {
  /** 1..9; defaults to 1. */
  level?: number;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  /** "#RRGGBB" */
  color?: string;
  /** Latin typeface name. */
  font?: string;
}

const fail = (code: string, detail: string): never => {
  throw new PptxEngineError(code, detail);
};

const escapeXmlAttr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ATTR_VALUE = (name: string) => new RegExp("\\s" + name + "\\s*=\\s*(?:\"[^\"]*\"|'[^']*')");

/** Set (or add) one attribute on an open tag such as `<a:defRPr sz="1800">`. */
function setAttr(openTag: string, name: string, value: string): string {
  const pattern = ATTR_VALUE(name);
  const attr = " " + name + '="' + escapeXmlAttr(value) + '"';
  if (pattern.test(openTag)) return openTag.replace(pattern, attr);
  const close = openTag.endsWith("/>") ? openTag.length - 2 : openTag.length - 1;
  return openTag.slice(0, close) + attr + openTag.slice(close);
}

const readAttr = (openTag: string, name: string): string | undefined => {
  const match = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')").exec(openTag);
  return match ? (match[1] ?? match[2]) : undefined;
};

/** Rename a master/layout: the `name` attribute of `<p:cSld>`. */
export function renamePartXml(xml: string, name: string): string {
  const open = /<p:cSld\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(xml);
  if (!open) return fail("master_part_malformed", "the part has no <p:cSld> element");
  return xml.slice(0, open.index) + setAttr(open[0], "name", name) + xml.slice(open.index + open[0].length);
}

const SHAPE_RE = /<p:sp\b[\s\S]*?<\/p:sp>/g;
const PH_RE = /<p:ph\b(?:[^>"']|"[^"]*"|'[^']*')*\/?>/;

/** `<p:ph>` without a type is a body placeholder (ECMA-376 19.3.1.36). */
const placeholderOf = (shape: string): MasterPlaceholderRef | null => {
  const ph = PH_RE.exec(shape)?.[0];
  if (!ph) return null;
  const idx = readAttr(ph, "idx");
  return { type: readAttr(ph, "type") ?? "body", ...(idx !== undefined ? { idx: Number(idx) } : {}) };
};

const samePlaceholder = (found: MasterPlaceholderRef, wanted: MasterPlaceholderRef): boolean =>
  found.type === wanted.type && (wanted.idx === undefined || (found.idx ?? 0) === wanted.idx);

/** Placeholders a slide carries at most once (PowerPoint refuses a second one). */
const SINGLE_PLACEHOLDERS = new Set(["title", "ctrTitle", "subTitle", "dt", "ftr", "sldNum"]);

/** Every placeholder slot of a part, document order. */
function listPlaceholders(xml: string): MasterPlaceholderRef[] {
  return [...xml.matchAll(SHAPE_RE)].map((match) => placeholderOf(match[0])).filter((ref): ref is MasterPlaceholderRef => ref !== null);
}

/** `idx` is an xsd:unsignedInt; 4294967295 is PowerPoint's orphan marker, never handed out. */
const ORPHAN_IDX = 4294967295;

/** The slot after the highest index in use (the orphan marker ignored); once
 *  that would reach the marker, the lowest index not taken. */
function nextPlaceholderIdx(existing: readonly MasterPlaceholderRef[]): number {
  const taken = new Set(existing.map((ref) => ref.idx ?? 0).filter((idx) => idx < ORPHAN_IDX));
  const next = Math.max(0, ...taken) + 1;
  if (next < ORPHAN_IDX) return next;
  let free = 1;
  while (taken.has(free)) free += 1;
  return free;
}

/** Append a placeholder shape to the part's shape tree. Returns the new XML and the slot it took. */
export function addPlaceholderXml(xml: string, type: string, box: MasterPlaceholderGeometry, label: string): { xml: string; placeholder: MasterPlaceholderRef } {
  const existing = listPlaceholders(xml);
  if (SINGLE_PLACEHOLDERS.has(type) && existing.some((ref) => ref.type === type)) {
    fail("master_placeholder_exists", 'the part already has a "' + type + '" placeholder');
  }
  const close = xml.lastIndexOf("</p:spTree>");
  if (close < 0) fail("master_part_malformed", "the part has no <p:spTree>");
  const ids = [...xml.matchAll(/<p:cNvPr\b[^>]*?\sid="(\d+)"/g)].map((match) => Number(match[1]));
  const id = Math.max(1, ...ids) + 1;
  // A title has no idx; every other slot takes the next free index.
  const idx = type === "title" || type === "ctrTitle" ? undefined : nextPlaceholderIdx(existing);
  const ph = '<p:ph type="' + escapeXmlAttr(type) + '"' + (idx !== undefined ? ' idx="' + String(idx) + '"' : "") + "/>";
  const shape =
    '<p:sp><p:nvSpPr><p:cNvPr id="' + String(id) + '" name="' + escapeXmlAttr(label + " " + String(id)) + '"/>' +
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' + ph + "</p:nvPr></p:nvSpPr>" +
    '<p:spPr><a:xfrm><a:off x="' + String(box.xEmu) + '" y="' + String(box.yEmu) + '"/>' +
    '<a:ext cx="' + String(box.cxEmu) + '" cy="' + String(box.cyEmu) + '"/></a:xfrm></p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>';
  return { xml: xml.slice(0, close) + shape + xml.slice(close), placeholder: { type, ...(idx !== undefined ? { idx } : {}) } };
}

/** Remove the first placeholder shape that matches the slot. */
export function removePlaceholderXml(xml: string, wanted: MasterPlaceholderRef): string {
  for (const match of xml.matchAll(SHAPE_RE)) {
    const found = placeholderOf(match[0]);
    if (found && samePlaceholder(found, wanted)) return xml.slice(0, match.index) + xml.slice(match.index + match[0].length);
  }
  return fail("master_no_placeholder", 'no "' + wanted.type + '" placeholder' + (wanted.idx !== undefined ? " idx " + String(wanted.idx) : "") + " on the part");
}

/** Find `<tag ...>...</tag>` or `<tag .../>` inside `scope`; the open tag and full element. */
function findElement(scope: string, tag: string, from = 0): { start: number; end: number; open: string; inner: string | null } | null {
  const pattern = new RegExp("<" + tag + "\\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", "g");
  pattern.lastIndex = from;
  const open = pattern.exec(scope);
  if (!open) return null;
  if (open[0].endsWith("/>")) return { start: open.index, end: open.index + open[0].length, open: open[0], inner: null };
  const closeTag = "</" + tag + ">";
  const close = scope.indexOf(closeTag, open.index + open[0].length);
  if (close < 0) return null;
  return { start: open.index, end: close + closeTag.length, open: open[0], inner: scope.slice(open.index + open[0].length, close) };
}

const element = (open: string, inner: string | null, tag: string): string => {
  if (inner === null || inner === "") return open.endsWith("/>") ? open : open.slice(0, -1) + "/>";
  const head = open.endsWith("/>") ? open.slice(0, -2) + ">" : open;
  return head + inner + "</" + tag + ">";
};

/** Insert `child` into `inner` before the first of `before` (tag names), else at the end. */
const insertBefore = (inner: string, child: string, before: readonly string[]): string => {
  const at = before.map((tag) => inner.search(new RegExp("<" + tag + "\\b"))).filter((index) => index >= 0);
  const index = at.length > 0 ? Math.min(...at) : inner.length;
  return inner.slice(0, index) + child + inner.slice(index);
};

const FILLS = ["a:noFill", "a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill", "a:grpFill"];

/** Children of `<a:defRPr>` that carry a fill of their own (text outline, underline line/fill). */
const FILL_OWNERS = ["a:ln", "a:uLn", "a:uFill"];

/** The text fill that is a direct child of the run properties: the first fill
 *  element outside every `<a:ln>` / `<a:uLn>` / `<a:uFill>` range. */
function findDirectFill(body: string): { start: number; end: number } | null {
  const skip: Array<[number, number]> = [];
  for (const tag of FILL_OWNERS) {
    for (let owner = findElement(body, tag); owner; owner = findElement(body, tag, owner.end)) skip.push([owner.start, owner.end]);
  }
  let best: { start: number; end: number } | null = null;
  for (const name of FILLS) {
    for (let hit = findElement(body, name); hit; hit = findElement(body, name, hit.end)) {
      if (skip.some(([start, end]) => hit.start >= start && hit.start < end)) continue;
      if (!best || hit.start < best.start) best = hit;
      break;
    }
  }
  return best;
}

/** Apply the patch to one `<a:defRPr>`, keeping its other attributes and children. */
function patchDefRPr(open: string, inner: string, patch: MasterTextStylePatch): string {
  let tag = open;
  if (patch.sizePt !== undefined) tag = setAttr(tag, "sz", String(Math.round(patch.sizePt * 100)));
  if (patch.bold !== undefined) tag = setAttr(tag, "b", patch.bold ? "1" : "0");
  if (patch.italic !== undefined) tag = setAttr(tag, "i", patch.italic ? "1" : "0");
  let body = inner;
  if (patch.color !== undefined) {
    const fill = '<a:solidFill><a:srgbClr val="' + patch.color.replace(/^#/, "").toUpperCase() + '"/></a:solidFill>';
    const current = findDirectFill(body);
    body = current ? body.slice(0, current.start) + fill + body.slice(current.end) : insertBefore(body, fill, ["a:effectLst", "a:effectDag", "a:highlight", "a:uLnTx", "a:uLn", "a:uFillTx", "a:uFill", "a:latin", "a:ea", "a:cs", "a:sym", "a:hlinkClick", "a:hlinkMouseOver", "a:rtl", "a:extLst"]);
  }
  if (patch.font !== undefined) {
    const latin = '<a:latin typeface="' + escapeXmlAttr(patch.font) + '"/>';
    const current = findElement(body, "a:latin");
    body = current ? body.slice(0, current.start) + latin + body.slice(current.end) : insertBefore(body, latin, ["a:ea", "a:cs", "a:sym", "a:hlinkClick", "a:hlinkMouseOver", "a:rtl", "a:extLst"]);
  }
  return element(tag, body, "a:defRPr");
}

/** Patch level N of a list style body (`<p:titleStyle>` content or `<a:lstStyle>` content). */
function patchLevelStyle(listInner: string, patch: MasterTextStylePatch): string {
  const level = patch.level ?? 1;
  const tag = "a:lvl" + String(level) + "pPr";
  let lvl = findElement(listInner, tag);
  let inner = listInner;
  if (!lvl) {
    const later = Array.from({ length: 9 - level }, (_, offset) => "a:lvl" + String(level + offset + 1) + "pPr");
    inner = insertBefore(listInner, "<" + tag + "/>", [...later, "a:extLst"]);
    lvl = findElement(inner, tag)!;
  }
  const lvlInner = lvl.inner ?? "";
  const def = findElement(lvlInner, "a:defRPr");
  const nextLvlInner = def
    ? lvlInner.slice(0, def.start) + patchDefRPr(def.open, def.inner ?? "", patch) + lvlInner.slice(def.end)
    : insertBefore(lvlInner, patchDefRPr("<a:defRPr/>", "", patch), ["a:extLst"]);
  return inner.slice(0, lvl.start) + element(lvl.open, nextLvlInner, tag) + inner.slice(lvl.end);
}

/** Master text styles that govern a placeholder type (`<p:txStyles>`). */
const TX_STYLE_OF: Record<string, string> = { title: "p:titleStyle", ctrTitle: "p:titleStyle", body: "p:bodyStyle", subTitle: "p:bodyStyle", obj: "p:bodyStyle" };

/** Set a placeholder's text style. On a master, title/body slots edit the
 *  master `<p:txStyles>` (what every layout and slide inherits); any other
 *  slot, and every slot on a layout, edits that placeholder's `<a:lstStyle>`. */
export function setTextStyleXml(xml: string, isMaster: boolean, wanted: MasterPlaceholderRef, patch: MasterTextStylePatch): string {
  const txStyle = isMaster ? TX_STYLE_OF[wanted.type] : undefined;
  if (txStyle) {
    const styles = findElement(xml, "p:txStyles");
    const scope = styles?.inner ?? null;
    const style = scope === null ? null : findElement(scope, txStyle);
    if (!styles || scope === null || !style) return fail("master_style_missing", "the master has no <" + txStyle + ">");
    const nextScope = scope.slice(0, style.start) + element(style.open, patchLevelStyle(style.inner ?? "", patch), txStyle) + scope.slice(style.end);
    return xml.slice(0, styles.start) + element(styles.open, nextScope, "p:txStyles") + xml.slice(styles.end);
  }
  for (const match of xml.matchAll(SHAPE_RE)) {
    const found = placeholderOf(match[0]);
    if (!found || !samePlaceholder(found, wanted)) continue;
    const shape = match[0];
    const body = findElement(shape, "p:txBody");
    if (!body || body.inner === null) return fail("master_no_text_body", 'the "' + wanted.type + '" placeholder has no text body');
    const list = findElement(body.inner, "a:lstStyle");
    const bodyInner = list
      ? body.inner.slice(0, list.start) + element(list.open, patchLevelStyle(list.inner ?? "", patch), "a:lstStyle") + body.inner.slice(list.end)
      : insertBefore(body.inner, element("<a:lstStyle>", patchLevelStyle("", patch), "a:lstStyle"), ["a:p"]);
    const nextShape = shape.slice(0, body.start) + element(body.open, bodyInner, "p:txBody") + shape.slice(body.end);
    return xml.slice(0, match.index) + nextShape + xml.slice(match.index + shape.length);
  }
  return fail("master_no_placeholder", 'no "' + wanted.type + '" placeholder on the part');
}
