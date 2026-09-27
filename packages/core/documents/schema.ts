/**
 * Page-JSON schema + sanitizer mirror (C-01 §3.7; UNI-675).
 *
 * This file is the TypeScript half of the Go/TS page contract: the closed
 * node/mark/attr vocabulary and the sanitize/extract rules are the same
 * rules `server/internal/document` enforces, and both sides are tested
 * against the shared fixtures in docs/parity/document-schema.json. The
 * client uses it for pre-validation and TipTap schema alignment; the server
 * remains the authority that sanitizes what is stored.
 */

export const DOCUMENT_NODE_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "mention",
  "text",
] as const;

export const DOCUMENT_MARK_TYPES = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
] as const;

export const DOCUMENT_MENTION_KINDS = ["user", "task", "document", "meeting"] as const;

export type DocumentNodeType = (typeof DOCUMENT_NODE_TYPES)[number];
export type DocumentMarkType = (typeof DOCUMENT_MARK_TYPES)[number];
export type DocumentMentionKind = (typeof DOCUMENT_MENTION_KINDS)[number];
export type DocumentKind = "page" | "file";
export type DocumentLevel = "" | "view" | "edit" | "manage";

export type DocumentErrorCode = "document_invalid" | "document_too_large";

export class DocumentContentError extends Error {
  readonly code: DocumentErrorCode;

  constructor(code: DocumentErrorCode, message: string) {
    super(message);
    this.name = "DocumentContentError";
    this.code = code;
  }
}

export interface SanitizeLimits {
  /** Rejects obviously oversized payloads before parsing. */
  maxInputBytes: number;
  /** Cap on the sanitized JSON re-encode (2 MiB on the wire). */
  maxBytes: number;
  /** Deepest node nesting; the doc root is depth 0. */
  maxDepth: number;
  /** Total node count including the doc root. */
  maxNodes: number;
  /** Bounds of one table's shape. */
  maxTableRows: number;
  maxTableCols: number;
}

/** The C-01 §3.7 contract bounds - keep in lockstep with Go DefaultLimits. */
export const DEFAULT_SANITIZE_LIMITS: SanitizeLimits = {
  maxInputBytes: 8 << 20,
  maxBytes: 2 << 20,
  maxDepth: 50,
  maxNodes: 50000,
  maxTableRows: 200,
  maxTableCols: 20,
};

type JsonObject = Record<string, unknown>;

interface NodeSpec {
  attrs?: Record<string, (v: unknown) => boolean>;
  required?: readonly string[];
  leaf?: boolean;
  inline?: boolean;
}

interface MarkSpec {
  attrs?: Record<string, (v: unknown) => boolean>;
  required?: readonly string[];
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const MAX_HREF_LENGTH = 2048;
const INT_MAX = Number.MAX_SAFE_INTEGER;

const isBool = (v: unknown): boolean => typeof v === "boolean";
const isIntBetween =
  (lo: number, hi: number) =>
  (v: unknown): boolean =>
    typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isStringLen =
  (n: number) =>
  (v: unknown): boolean =>
    typeof v === "string" && [...v].length <= n;
const isULID = (v: unknown): boolean => typeof v === "string" && ULID_PATTERN.test(v);
const isAssetRef = (v: unknown): boolean =>
  typeof v === "string" && v.startsWith("asset://") && ULID_PATTERN.test(v.slice(8));
const isMentionKind = (v: unknown): boolean =>
  typeof v === "string" && (DOCUMENT_MENTION_KINDS as readonly string[]).includes(v);

const hasSpace = (s: string): boolean => /[ \t\n\r\f\v]/.test(s);

/** https://, mailto: or a root-absolute internal path; nothing else. */
const isSafeHref = (v: unknown): boolean => {
  if (typeof v !== "string" || v === "" || [...v].length > MAX_HREF_LENGTH || hasSpace(v)) {
    return false;
  }
  if (v.startsWith("https://")) return v.length > "https://".length;
  if (v.startsWith("mailto:")) return v.length > "mailto:".length;
  if (v.startsWith("/")) return !v.startsWith("//");
  return false;
};

const NODE_SPECS: Record<string, NodeSpec> = {
  paragraph: {},
  heading: { attrs: { level: isIntBetween(1, 3) }, required: ["level"] },
  bulletList: {},
  orderedList: { attrs: { start: isIntBetween(1, INT_MAX) } },
  listItem: {},
  taskList: {},
  taskItem: { attrs: { checked: isBool } },
  blockquote: {},
  codeBlock: { attrs: { language: isStringLen(64) } },
  horizontalRule: { leaf: true },
  hardBreak: { leaf: true, inline: true },
  image: {
    attrs: { src: isAssetRef, alt: isStringLen(512), width: isIntBetween(1, INT_MAX) },
    required: ["src"],
    leaf: true,
    inline: true,
  },
  table: {},
  tableRow: {},
  tableCell: {
    attrs: { colspan: isIntBetween(1, INT_MAX), rowspan: isIntBetween(1, INT_MAX) },
  },
  tableHeader: {
    attrs: { colspan: isIntBetween(1, INT_MAX), rowspan: isIntBetween(1, INT_MAX) },
  },
  mention: {
    attrs: { kind: isMentionKind, id: isULID, label: isStringLen(256) },
    required: ["kind", "id"],
    leaf: true,
    inline: true,
  },
  text: { leaf: true, inline: true },
};

const MARK_SPECS: Record<string, MarkSpec> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  link: { attrs: { href: isSafeHref }, required: ["href"] },
};

export interface SanitizedPage {
  /** The sanitized {type:"doc"} document. */
  content: JsonObject;
  /** content_text as the server extracts it. */
  text: string;
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

const invalid = (msg: string): DocumentContentError =>
  new DocumentContentError("document_invalid", msg);
const tooLarge = (msg: string): DocumentContentError =>
  new DocumentContentError("document_too_large", msg);

/**
 * Sanitize one page payload. `input` is the raw JSON string (it is parsed
 * here so malformed input fails identically on both sides) or an
 * already-parsed value. Unknown nodes, marks and attrs are dropped; limit
 * violations throw DocumentContentError with the wire code.
 */
export function sanitizePageContent(
  input: unknown,
  limits: SanitizeLimits = DEFAULT_SANITIZE_LIMITS,
): SanitizedPage {
  let root: unknown = input;
  if (typeof input === "string") {
    if (byteLength(input) > limits.maxInputBytes) {
      throw tooLarge(`input exceeds ${limits.maxInputBytes} bytes`);
    }
    try {
      root = JSON.parse(input);
    } catch {
      throw invalid("malformed JSON");
    }
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    throw invalid("root is not an object");
  }
  const doc = root as JsonObject;
  if (doc.type !== "doc") {
    throw invalid('root type is not "doc"');
  }
  let children: unknown[] = [];
  if (doc.content !== undefined && doc.content !== null) {
    if (!Array.isArray(doc.content)) {
      throw invalid("doc content is not an array");
    }
    children = doc.content;
  }

  const walker = { nodes: 1 };
  const out = sanitizeChildren(children, 1, walker, limits);
  const outDoc: JsonObject = { type: "doc", content: out };
  const enc = JSON.stringify(outDoc);
  if (byteLength(enc) > limits.maxBytes) {
    throw tooLarge(`sanitized document exceeds ${limits.maxBytes} bytes`);
  }
  return { content: outDoc, text: extractText(outDoc) };
}

function sanitizeChildren(
  input: unknown[],
  depth: number,
  walker: { nodes: number },
  limits: SanitizeLimits,
): unknown[] {
  const out: unknown[] = [];
  for (const item of input) {
    const node = sanitizeNode(item, depth, walker, limits);
    if (node !== null) {
      out.push(node);
    }
  }
  return out;
}

function sanitizeNode(
  item: unknown,
  depth: number,
  walker: { nodes: number },
  limits: SanitizeLimits,
): JsonObject | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const obj = item as JsonObject;
  const name = obj.type;
  const spec = typeof name === "string" ? NODE_SPECS[name] : undefined;
  if (!spec || typeof name !== "string") {
    return null;
  }
  walker.nodes += 1;
  if (walker.nodes > limits.maxNodes) {
    throw invalid("document exceeds node limit");
  }
  if (depth > limits.maxDepth) {
    throw invalid("document exceeds depth limit");
  }

  const out: JsonObject = { type: name };

  // Attrs (or the text key on text nodes). A failed required attr drops the
  // node; a failed optional attr just drops the attr.
  if (name === "text") {
    if (typeof obj.text !== "string") {
      return null;
    }
    out.text = obj.text;
  } else {
    const kept = filterAttrs(obj.attrs, spec);
    if (kept === null) {
      return null;
    }
    if (Object.keys(kept).length > 0) {
      out.attrs = kept;
    }
  }

  if (Array.isArray(obj.marks)) {
    const kept = sanitizeMarks(obj.marks);
    if (kept.length > 0) {
      out.marks = kept;
    }
  }

  if (spec.leaf) {
    return out;
  }

  const content: unknown[] = [];
  // Mirrors Go: a present content key (even null) must be an array.
  if ("content" in obj) {
    if (!Array.isArray(obj.content)) {
      throw invalid("node content is not an array");
    }
    content.push(...obj.content);
  }
  const children = sanitizeChildren(content, depth + 1, walker, limits);
  out.content = children;
  if (name === "table") {
    checkTable(children, limits);
  }
  return out;
}

/** null when a required attr fails - the caller drops the node. */
function filterAttrs(raw: unknown, spec: NodeSpec): JsonObject | null {
  const attrs = isPlainObject(raw) ? (raw as JsonObject) : {};
  const kept: JsonObject = {};
  for (const [k, v] of Object.entries(attrs)) {
    const rule = spec.attrs?.[k];
    if (rule && rule(v)) {
      kept[k] = v;
    }
  }
  for (const req of spec.required ?? []) {
    if (!(req in kept)) {
      return null;
    }
  }
  return kept;
}

function sanitizeMarks(input: unknown[]): JsonObject[] {
  const out: JsonObject[] = [];
  for (const item of input) {
    if (!isPlainObject(item)) continue;
    const obj = item as JsonObject;
    const name = obj.type;
    const spec = typeof name === "string" ? MARK_SPECS[name] : undefined;
    if (!spec || typeof name !== "string") continue;
    const kept = filterAttrs(obj.attrs, spec);
    if (kept === null) continue;
    const mark: JsonObject = { type: name };
    if (Object.keys(kept).length > 0) {
      mark.attrs = kept;
    }
    out.push(mark);
  }
  return out;
}

function checkTable(children: unknown[], limits: SanitizeLimits): void {
  if (children.length > limits.maxTableRows) {
    throw invalid("table exceeds row limit");
  }
  for (const row of children) {
    const cells = isPlainObject(row) ? (row as JsonObject).content : undefined;
    if (Array.isArray(cells) && cells.length > limits.maxTableCols) {
      throw invalid("table exceeds column limit");
    }
  }
}

const isPlainObject = (v: unknown): boolean =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * content_text extraction: text nodes give their text, mentions their label,
 * images their alt, hardBreak a newline; inline children join directly,
 * anything else is newline-separated.
 */
export function extractText(doc: JsonObject): string {
  return fragOf(doc);
}

function fragOf(node: JsonObject): string {
  const name = typeof node.type === "string" ? node.type : "";
  const spec = NODE_SPECS[name];

  if (name === "text") {
    return typeof node.text === "string" ? node.text : "";
  }
  if (name === "hardBreak") {
    return "\n";
  }
  if (name === "mention" || name === "image") {
    const attrs = isPlainObject(node.attrs) ? (node.attrs as JsonObject) : {};
    const key = name === "mention" ? "label" : "alt";
    return typeof attrs[key] === "string" ? (attrs[key] as string) : "";
  }

  if (spec === undefined && name !== "doc") {
    return "";
  }
  const children = Array.isArray(node.content) ? node.content : [];
  const parts: { s: string; inline: boolean }[] = [];
  for (const child of children) {
    if (!isPlainObject(child)) continue;
    const s = fragOf(child as JsonObject);
    if (s === "") continue;
    const cn = typeof (child as JsonObject).type === "string" ? ((child as JsonObject).type as string) : "";
    parts.push({ s, inline: NODE_SPECS[cn]?.inline === true });
  }
  let out = "";
  let prevInline = true;
  let first = true;
  for (const p of parts) {
    if (!first && !(p.inline && prevInline)) {
      out += "\n";
    }
    out += p.s;
    prevInline = p.inline;
    first = false;
  }
  return out;
}
