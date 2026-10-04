import type { UpstreamParseMap, UpstreamPatch, UpstreamPatchSet } from "@uniwork/office-engine/html";

// Target resolution for the HTML visual document ops. Everything here is pure:
// it reads the engine's parse map (the structural model over the source text)
// and returns the element a patch targets. No DOM, no React, no host port -
// the same code runs in the web host, the desktop renderer and a unit test.

/** One element of the engine's parse map (upstream ElementEntry). */
export type HtmlElementEntry = UpstreamParseMap["elements"][number];
/** Patch provenance carried on every set an op builds. */
export type PatchOrigin = UpstreamPatchSet["origin"];

/** A half-open source range `[from, to)` in code units. */
export type SourceRange = readonly [number, number];

/** How an op names the element it edits: by stable sid, by structural path,
 * or by a source range that a smallest-covering-element lookup resolves. */
export type HtmlTarget = { sid: number } | { path: string } | { range: SourceRange };

export type HtmlOpErrorCode =
  | "element_not_found"
  | "invalid_target"
  | "invalid_range"
  | "invalid_move"
  | "no_op"
  | "attribute_not_found"
  | "text_node_not_found";

/** Every failure an op builder raises. A caller branches on `code`, never on
 * message text. */
export class HtmlOpError extends Error {
  readonly code: HtmlOpErrorCode;
  readonly fields: Record<string, unknown>;

  constructor(code: HtmlOpErrorCode, message: string, fields: Record<string, unknown> = {}) {
    super(message);
    this.name = "HtmlOpError";
    this.code = code;
    this.fields = fields;
  }
}

export function elementBySid(map: UpstreamParseMap, sid: number): HtmlElementEntry | null {
  return map.bySid.get(sid) ?? null;
}

export function elementByPath(map: UpstreamParseMap, path: string): HtmlElementEntry | null {
  for (const element of map.elements) if (element.path === path) return element;
  return null;
}

/** Smallest element whose range covers `[from, to]`; null when nothing does. */
export function elementCovering(map: UpstreamParseMap, from: number, to: number): HtmlElementEntry | null {
  let best: HtmlElementEntry | null = null;
  for (const element of map.elements) {
    if (element.range[0] <= from && element.range[1] >= to) {
      if (!best || element.range[1] - element.range[0] <= best.range[1] - best.range[0]) best = element;
    }
  }
  return best;
}

/** The element a target names, or null when it names none. */
export function resolveElement(map: UpstreamParseMap, target: HtmlTarget): HtmlElementEntry | null {
  if ("sid" in target) return elementBySid(map, target.sid);
  if ("path" in target) return elementByPath(map, target.path);
  return elementCovering(map, target.range[0], target.range[1]);
}

/** The element a target names; throws `element_not_found` when it names none. */
export function requireElement(map: UpstreamParseMap, target: HtmlTarget): HtmlElementEntry {
  const element = resolveElement(map, target);
  if (!element) {
    throw new HtmlOpError("element_not_found", "no element matches the target", {
      target: "sid" in target ? target.sid : "path" in target ? target.path : target.range,
    });
  }
  return element;
}

/** Ancestors from the root down to (excluding) the element. */
export function ancestorsOf(map: UpstreamParseMap, sid: number): HtmlElementEntry[] {
  const out: HtmlElementEntry[] = [];
  let current = elementBySid(map, sid);
  while (current && current.parentSid !== null) {
    const parent = elementBySid(map, current.parentSid);
    if (!parent) break;
    out.unshift(parent);
    current = parent;
  }
  return out;
}

/** True when `sid` sits inside the subtree of `ancestorSid` (never itself). */
export function isDescendant(map: UpstreamParseMap, ancestorSid: number, sid: number): boolean {
  if (ancestorSid === sid) return false;
  let current = elementBySid(map, sid);
  while (current && current.parentSid !== null) {
    if (current.parentSid === ancestorSid) return true;
    current = elementBySid(map, current.parentSid);
  }
  return false;
}

/** Build a patch set against `version`. Patches stay in ORIGINAL coordinates;
 * the engine validates and applies them (never splice the source yourself). */
export function patchSet(
  version: number,
  patches: readonly UpstreamPatch[],
  origin: PatchOrigin = "inspector",
  label = "html-op",
): UpstreamPatchSet {
  return { patches: [...patches], baseVersion: version, origin, label };
}

export function replaceRange(
  version: number,
  from: number,
  to: number,
  text: string,
  origin?: PatchOrigin,
  label?: string,
): UpstreamPatchSet {
  return patchSet(version, [{ from, to, text }], origin, label);
}

export function insertAt(
  version: number,
  at: number,
  text: string,
  origin?: PatchOrigin,
  label?: string,
): UpstreamPatchSet {
  return patchSet(version, [{ from: at, to: at, text }], origin, label);
}

export interface HtmlAttribute {
  name: string;
  value: string;
  /** Range of the attribute name in the source. */
  nameStart: number;
  nameEnd: number;
  /** Range of the raw attribute value (without quotes) in the source. */
  valueStart: number;
  valueEnd: number;
  quote: '"' | "'" | null;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/** Decode the entities an attribute value can carry back to characters. */
export function decodeAttributeValue(raw: string): string {
  return raw.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Attributes of one start tag, in source order, with their exact ranges. */
export function parseStartTagAttributes(text: string, startTag: SourceRange): HtmlAttribute[] {
  const raw = text.slice(startTag[0], startTag[1]);
  const attrs: HtmlAttribute[] = [];
  const nameMatch = /^<[^\s/>]*/.exec(raw);
  let i = nameMatch ? nameMatch[0].length : 1;
  const n = raw.length;
  while (i < n) {
    while (i < n && /[\s/]/.test(raw[i]!)) i++;
    if (i >= n || raw[i] === ">") break;
    const nameStart = i;
    while (i < n && !/[\s=/>]/.test(raw[i]!)) i++;
    const name = raw.slice(nameStart, i).toLowerCase();
    if (name === "") {
      i++;
      continue;
    }
    const nameEnd = i;
    while (i < n && /\s/.test(raw[i]!)) i++;
    if (raw[i] !== "=") {
      const at = startTag[0] + i;
      attrs.push({
        name,
        value: "",
        nameStart: startTag[0] + nameStart,
        nameEnd: startTag[0] + nameEnd,
        valueStart: at,
        valueEnd: at,
        quote: null,
      });
      continue;
    }
    i++;
    while (i < n && /\s/.test(raw[i]!)) i++;
    const quote = raw[i];
    if (quote === '"' || quote === "'") {
      const close = raw.indexOf(quote, i + 1);
      const end = close === -1 ? n : close;
      attrs.push({
        name,
        value: raw.slice(i + 1, end),
        nameStart: startTag[0] + nameStart,
        nameEnd: startTag[0] + nameEnd,
        valueStart: startTag[0] + i + 1,
        valueEnd: startTag[0] + end,
        quote,
      });
      i = end + 1;
    } else {
      const valueStart = i;
      while (i < n && !/[\s>]/.test(raw[i]!)) i++;
      attrs.push({
        name,
        value: raw.slice(valueStart, i),
        nameStart: startTag[0] + nameStart,
        nameEnd: startTag[0] + nameEnd,
        valueStart: startTag[0] + valueStart,
        valueEnd: startTag[0] + i,
        quote: null,
      });
    }
  }
  return attrs;
}

export function findAttribute(attrs: readonly HtmlAttribute[], name: string): HtmlAttribute | null {
  const wanted = name.toLowerCase();
  for (const attr of attrs) if (attr.name === wanted) return attr;
  return null;
}

/** Where a new attribute is inserted in a start tag: just before `>` (or the
 * `/` of a self-closing tag). */
export function attributeInsertionPoint(text: string, startTag: SourceRange): number {
  const raw = text.slice(startTag[0], startTag[1]);
  return startTag[1] - (/\/\s*>$/.test(raw) ? 2 : 1);
}

/** Encode a value for an attribute quoting context. A null quote (unquoted
 * value) escapes every character that would end the value. */
export function encodeAttributeValue(value: string, quote: '"' | "'" | null): string {
  let out = "";
  for (const ch of value) {
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (quote === '"' && ch === '"') out += "&quot;";
    else if (quote === "'" && ch === "'") out += "&#39;";
    else if (quote === null && /[\s"'`=>]/.test(ch)) out += "&#" + ch.codePointAt(0) + ";";
    else out += ch;
  }
  return out;
}
