// DOC-003 engine host: DOCX parse/edit/save on the real docx engine.
//
// The docs renderer already parses and serializes real bytes in the browser, so
// this route exists for the engine-side oracle only: parse a fixture, rebuild one
// editable paragraph as a generated block, save, then re-parse and prove the new
// text landed while unrelated blocks (table, image, headings) survived.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  [key: string]: unknown;
}

export interface DocxBlock {
  id?: string;
  type: string;
  docxIndex: number | null;
  hidden?: boolean;
  runs?: DocxRun[];
  [key: string]: unknown;
}

export interface DocxParsed {
  blocks: DocxBlock[];
  [key: string]: unknown;
}

export type DocxSaveBlock =
  | { kind: "original"; docxIndex: number }
  | { kind: "generated"; block: { type: "paragraph" | "heading" | "listItem"; runs: DocxRun[]; level?: number } };

export interface DocxEngine {
  parse(bytes: Uint8Array): Promise<DocxParsed>;
  editParagraph(input: {
    parsed: DocxParsed;
    docxIndex: number;
    text: string;
    bold?: boolean;
  }): { plan: DocxSaveBlock[]; replacedIndex: number };
  save(parsed: DocxParsed, plan: DocxSaveBlock[]): Promise<Uint8Array>;
  plainText(parsed: DocxParsed): string;
  editableIndexes(parsed: DocxParsed): number[];
  visibleIndexes(parsed: DocxParsed): number[];
}

export class DocxEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DocxEngineError";
    this.code = code;
  }
}

/**
 * Every legal original top-level block, in document order: the only set a save
 * plan may draw originals from. This is not the editable set.
 */
export function visibleIndexes(parsed: DocxParsed): number[] {
  return parsed.blocks
    .filter((block) => !block.hidden && block.docxIndex !== null)
    .map((block) => block.docxIndex as number);
}

/**
 * The editable set of this narrow, paragraph-only oracle: visible paragraphs.
 * Headings, list items, tables, images and passthrough blocks stay inventoried
 * here but are not editable targets; this oracle never retypes one as a paragraph.
 */
export function editableIndexes(parsed: DocxParsed): number[] {
  return parsed.blocks
    .filter((block) => !block.hidden && block.docxIndex !== null && block.type === "paragraph")
    .map((block) => block.docxIndex as number);
}

export function plainText(parsed: DocxParsed): string {
  return parsed.blocks
    .map((block) => (block.runs ?? []).map((run) => run.text ?? "").join(""))
    .join("\n");
}

/**
 * Resolve one uniquely indexed, visible paragraph, or refuse with a typed error.
 * Called before any save or staging, so a rejected target never writes output.
 */
export function requireParagraphTarget(parsed: DocxParsed, docxIndex: number): DocxBlock {
  if (!Number.isInteger(docxIndex)) {
    throw new DocxEngineError("bad_index", "docxIndex must be an integer, got " + String(docxIndex));
  }
  const block = parsed.blocks.find((candidate) => candidate.docxIndex === docxIndex);
  if (block === undefined) {
    throw new DocxEngineError("bad_index", "no top-level block has docxIndex " + docxIndex);
  }
  const occurrences = parsed.blocks.filter((candidate) => candidate.docxIndex === docxIndex).length;
  if (occurrences > 1) {
    throw new DocxEngineError(
      "ambiguous_index",
      "docxIndex " + docxIndex + " matches " + occurrences + " blocks",
    );
  }
  if (block.hidden) {
    throw new DocxEngineError("hidden_target", "docxIndex " + docxIndex + " is hidden, not an editable paragraph");
  }
  if (block.type !== "paragraph") {
    throw new DocxEngineError(
      "unsupported_target",
      "docxIndex " + docxIndex + " is a " + block.type + " block; this oracle edits paragraphs only",
    );
  }
  return block;
}

export function buildPlan(parsed: DocxParsed, replaceIndex: number, text: string, bold = true): DocxSaveBlock[] {
  // Refuse a heading/list/table/image/passthrough/hidden/missing target before
  // any save or staging; this oracle must not change such a block's type.
  requireParagraphTarget(parsed, replaceIndex);
  // Retain every legal original top-level block, in original order; only the
  // selected paragraph itself becomes a generated replacement. The paragraph-only
  // editable list is deliberately not reused as the plan's original set.
  return visibleIndexes(parsed).map((index) =>
    index === replaceIndex
      ? { kind: "generated", block: { type: "paragraph", runs: [{ text, bold }] } }
      : { kind: "original", docxIndex: index },
  );
}

export interface DocxEngineDeps {
  parseDocx: (bytes: Uint8Array) => Promise<DocxParsed>;
  saveDocx: (parsed: DocxParsed, plan: DocxSaveBlock[]) => Promise<Uint8Array>;
}

export function createDocxEngine(deps: DocxEngineDeps): DocxEngine {
  return {
    parse: (bytes) => deps.parseDocx(bytes),

    editParagraph({ parsed, docxIndex, text, bold }) {
      if (typeof text !== "string" || text.length === 0) {
        throw new DocxEngineError("empty_text", "the replacement paragraph text must be non-empty");
      }
      return { plan: buildPlan(parsed, docxIndex, text, bold ?? true), replacedIndex: docxIndex };
    },

    save: (parsed, plan) => deps.saveDocx(parsed, plan),

    plainText,

    editableIndexes,

    visibleIndexes,
  };
}

export async function loadDocxDeps(sourceRoot: string): Promise<{
  parseDocx: (bytes: Uint8Array) => Promise<DocxParsed>;
  saveDocx: (parsed: DocxParsed, plan: DocxSaveBlock[]) => Promise<Uint8Array>;
}> {
  const mod = (await import(
    pathToFileURL(join(sourceRoot, "packages/docx-engine/src/index.ts")).href
  )) as {
    parseDocx: (bytes: Uint8Array, options?: unknown) => Promise<DocxParsed>;
    saveDocx: (parsed: DocxParsed, plan: DocxSaveBlock[], options?: unknown) => Promise<Uint8Array>;
  };
  return {
    parseDocx: (bytes) => mod.parseDocx(bytes),
    saveDocx: (parsed, plan) => mod.saveDocx(parsed, plan),
  };
}