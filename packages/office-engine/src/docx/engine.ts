// DOCX engine seam — structural types the adapter actually reads/writes.
//
// Real upstream signatures this seam mirrors (genoffice pinned at
// 09485f884dc845cf3bf27fb7edfe489f9d457aad — READ ONLY, never imported):
//   parseDocx(bytes: Uint8Array, options?: ParseOptions)
//     => Promise<ParsedDoc & { extras: ParseExtras }>
//       packages/docx-engine/src/parse.ts:299  (ParseOptions parse.ts:294)
//   saveDocx(parsed: ParsedDocFull, finalBlocks: SaveBlock[], options?: SaveOptions)
//     => Promise<Uint8Array>
//       packages/docx-engine/src/patch.ts:339  (SaveBlock patch.ts:88, SaveOptions patch.ts:111)
//   isEncryptedDocx / decryptDocx / encryptDocx
//       apps/docs/src/main/docx-encryption.ts:24 / :43 / :56
//   password intents (setDocPassword/currentDocPasswordIntentRevision/
//     discardDocPasswordIntents/snapshotDocPassword/commitDocPasswordSave)
//       apps/docs/src/main/docx-encryption.ts:105 / :121 / :130 / :156 / :175
//
// Only the fields this adapter reads or writes are declared; the loose index
// signatures are intentional so the real ParsedDocFull satisfies the seam in
// G2-03b without copying the upstream model wholesale.

export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** ids of comments whose range covers this run (upstream types.ts:127); a
   * regenerated paragraph re-emits commentRangeStart/End + reference around
   * the first..last covered run. Only set when the whole range sits inside
   * this paragraph — cross-paragraph endpoints ride on the block instead. */
  commentIds?: string[];
  /** The run is a footnote/endnote reference marker (upstream types.ts:137).
   * `text` holds the display number; a save emits the marker itself
   * (w:footnoteReference/w:endnoteReference) and Word renumbers from the part
   * order. */
  noteRef?: { kind: DocxNoteKind; id: string };
  [key: string]: unknown;
}

/** Block — upstream Block (types.ts:1395): type/docxIndex/hidden/runs are the
 * fields the adapter's save-plan logic needs. */
export interface DocxBlock {
  id?: string;
  type: string;
  docxIndex: number | null;
  hidden?: boolean;
  runs?: DocxRun[];
  [key: string]: unknown;
}

/** NumberingLevel — upstream types.ts:779. A renderer that draws list markers
 * reads these fields (marker format/text, bullet picture, fallback indent);
 * the engine owns the rest. */
export interface DocxNumberingLevel {
  numFmt?: string;
  lvlText?: string;
  start?: number;
  /** twips: fallback geometry for items without their own w:ind */
  indentLeft?: number;
  hanging?: number;
  firstLine?: number;
  picBulletSrc?: string;
  [key: string]: unknown;
}

/** NumberingDef — upstream types.ts:810: one w:num entry from
 * word/numbering.xml, abstract levels + overrides applied. */
export interface DocxNumberingDef {
  numId: string;
  /** counters continue across w:num entries sharing an abstractNum */
  abstractNumId: string;
  /** ilvl -> level definition */
  levels: Record<number, DocxNumberingLevel>;
  /** ilvl -> w:lvlOverride/w:startOverride value (restart markers) */
  startOverrides: Record<number, number>;
  [key: string]: unknown;
}

/** CommentInfo — upstream types.ts:253. One comment from word/comments.xml;
 * the authoritative list a save regenerates the part from. `parentId` marks a
 * reply (resolved through commentsExtended), `done` the resolved state, and
 * `paraId` is the commentsExtended link key (assigned on save for new ones). */
export interface DocxCommentInfo {
  id: string;
  author: string;
  initials?: string;
  /** ISO timestamp from w:date */
  date?: string;
  /** plain text, paragraphs joined with \n */
  text: string;
  /** the parent comment's w:id when this entry is a reply */
  parentId?: string;
  /** resolved (w15:done); Word resolves a whole thread together */
  done?: boolean;
  /** w14:paraId of the comment's last paragraph (commentsExtended link key) */
  paraId?: string;
  [key: string]: unknown;
}

/** The two note parts share one schema; the kind selects which part. */
export type DocxNoteKind = "footnote" | "endnote";

/** NoteRun — upstream types.ts:897. One display run of note body text; the
 * save-side rebuild reads these when an entry carries measured rich runs. */
export interface DocxNoteRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  sizeHalfPoints?: number;
  caps?: "all" | "small";
  fontAscii?: string;
  font?: string;
  [key: string]: unknown;
}

/** Direct w:spacing of a note's first paragraph, in twips (upstream NoteInfo
 * spacing: they override the style chain). */
export interface DocxNoteSpacing {
  beforeTwips?: number;
  afterTwips?: number;
  lineRawTwips?: number;
  lineRule?: "auto" | "atLeast" | "exact";
  [key: string]: unknown;
}

/** NoteInfo — upstream types.ts:917. One footnote/endnote from its part. The
 * list is what a save regenerates word/footnotes.xml / word/endnotes.xml from
 * (buildNotesXml keeps unchanged entries byte-identical, preserves structural
 * separator entries, and drops a rich rebuild when `richParas` is absent —
 * so a plain-text edit drops them on purpose). Note numbers follow list
 * order: deleting a note renumbers the survivors in the saved part. */
export interface DocxNoteInfo {
  /** original w:id, unique within its part */
  id: string;
  /** plain text, paragraphs joined with \n */
  text: string;
  /** rich display runs (one group per paragraph) */
  richParas?: DocxNoteRun[][];
  /** no self-reference mark run in the body: Word renders no number mark */
  noRefMark?: true;
  /** w:pStyle of the first note paragraph */
  styleId?: string;
  spacing?: DocxNoteSpacing;
  [key: string]: unknown;
}

/** ParsedDoc + ParseExtras handle: the adapter treats everything outside
 * `blocks` as opaque and passes the whole object back to saveDocx, exactly
 * like upstream (patch.ts:85 ParsedDocFull). */
export interface DocxParsed {
  blocks: DocxBlock[];
  /** numId -> definition, from word/numbering.xml (upstream parse.ts:573);
   * a rendering host needs these to draw the document's real list markers. */
  numbering?: Map<string, DocxNumberingDef>;
  /** comments from word/comments.xml, in file order (upstream types.ts:2124). */
  comments?: DocxCommentInfo[];
  /** notes from word/footnotes.xml / word/endnotes.xml, in part order; the
   * order is the display number. */
  footnotes?: DocxNoteInfo[];
  endnotes?: DocxNoteInfo[];
  /** `${kind}:${id}` -> display number, derived from part order on parse. */
  noteNumbers?: Record<string, number>;
  internal?: Record<string, unknown>;
  extras?: { chartParts?: Record<string, string>; [key: string]: unknown };
  [key: string]: unknown;
}

/** GeneratedBlock — upstream types.ts:1757. Only text-bearing kinds can be
 * generated; tables/images/charts go through xml/image/chart kinds instead. */
export interface DocxGeneratedBlock {
  type: "paragraph" | "heading" | "listItem";
  level?: number;
  outlineOnly?: boolean;
  styleId?: string;
  list?: { kind: "bullet" | "ordered"; numId: string; ilvl: number };
  /** cross-paragraph comment range starts re-emitted at paragraph start
   * (upstream types.ts:1771) — the anchor's opening half. */
  commentStarts?: string[];
  /** cross-paragraph range ends, emitted with their reference at paragraph
   * end (upstream types.ts:1773) — the anchor's closing half. */
  commentEnds?: string[];
  runs: DocxRun[];
  [key: string]: unknown;
}

/** ImageWrap — upstream types.ts:1331 verbatim: the wrap modes generate.ts
 * encodes. tight/through keep their own anchor kind for fidelity (a
 * reposition reuses the original wrapTight/wrapThrough bytes). Absent = inline. */
export type DocxImageWrap =
  | "square-left"
  | "square-right"
  | "tight-left"
  | "tight-right"
  | "through-left"
  | "through-right"
  | "topBottom"
  | "behind"
  | "front";

export const DOCX_IMAGE_WRAPS: readonly DocxImageWrap[] = [
  "square-left",
  "square-right",
  "tight-left",
  "tight-right",
  "through-left",
  "through-right",
  "topBottom",
  "behind",
  "front",
];

/** NewImage — upstream types.ts:1343. Crop is bytes-level: a cropped picture is
 * re-encoded before it reaches the engine (new image = cropped genImage bytes,
 * original image = replaceImage bytes), so no crop field exists here. */
export interface DocxNewImage {
  base64: string;
  mime: "image/png" | "image/jpeg" | "image/gif";
  widthPx: number;
  heightPx: number;
  align?: "left" | "center" | "right";
  altText?: string;
  wrap?: DocxImageWrap;
  posOffsetEmu?: { x: number; y: number; relativeTo?: "page" | "margin" };
  zOrder?: number;
  rotDeg?: number;
  flipH?: boolean;
  flipV?: boolean;
  [key: string]: unknown;
}

/** NewChart — upstream patch.ts:101 (kind "chart"). Kept opaque: chart payload
 * authoring is editor work; the adapter only carries the fragment. */
export interface DocxNewChart {
  [key: string]: unknown;
}

/** HeaderFooter — upstream types.ts:821. */
export interface DocxHeaderFooter {
  text: string;
  pageNumber?: boolean;
  paras?: unknown[];
  [key: string]: unknown;
}

/** SaveBlock — upstream patch.ts:88-109 verbatim union, plus the shared
 * `revision` tail (tracked insertion/deletion wrapper). */
export type DocxSaveBlock = (
  | { kind: "original"; docxIndex: number }
  | { kind: "generated"; block: DocxGeneratedBlock }
  | {
      kind: "xml";
      xml: string;
      docxIndex?: number;
      replaceImage?: { base64: string; mime: DocxNewImage["mime"] };
    }
  | { kind: "image"; image: DocxNewImage }
  | { kind: "chart"; chart: DocxNewChart; extentPx?: { w: number; h: number } }
) & {
  revision?: { kind: "ins" | "del"; author: string; date?: string; id?: string };
};

/** SaveOptions — upstream patch.ts:111. The adapter only ever sets the
 * header/footer + savedAt surface; every other field stays "keep as-is". */
export interface DocxSaveOptions {
  savedAt?: string;
  header?: DocxHeaderFooter;
  footer?: DocxHeaderFooter;
  headerFirst?: DocxHeaderFooter;
  footerFirst?: DocxHeaderFooter;
  headerEven?: DocxHeaderFooter;
  footerEven?: DocxHeaderFooter;
  titlePg?: boolean;
  evenAndOddHeaders?: boolean;
  sectionHf?: Array<{ lastBlockIndex: number; kind: "header" | "footer"; hf: DocxHeaderFooter }>;
  hfAllSections?: boolean;
  /** Full desired comment list; word/comments.xml is regenerated from it and
   * body markers for ids no longer present are removed (upstream patch.ts:193).
   * undefined keeps the part byte-identical. */
  comments?: DocxCommentInfo[];
  /** Full desired footnote/endnote lists; the part is regenerated in list
   * order and the separators from the original part are kept byte-identical
   * (upstream patch.ts:205, notes.ts:307). undefined keeps the part
   * byte-identical. */
  footnotes?: DocxNoteInfo[];
  endnotes?: DocxNoteInfo[];
  [key: string]: unknown;
}

/** ParseOptions — upstream parse.ts:294. @public — seam type for the G2-03b vendored binding. */
export interface DocxParseOptions {
  expandAltChunks?: boolean;
  [key: string]: unknown;
}

/** The two real engine functions (parse.ts:299, patch.ts:339). */
export interface DocxEngineFunctions {
  parseDocx(bytes: Uint8Array, options?: DocxParseOptions): Promise<DocxParsed>;
  saveDocx(
    parsed: DocxParsed,
    finalBlocks: DocxSaveBlock[],
    options?: DocxSaveOptions,
  ): Promise<Uint8Array>;
}

/** OOXML crypto seam — docx-encryption.ts:43/56. `encrypt` is optional: when
 * absent the adapter carries intent state to the service or refuses the save
 * by policy, never writes plaintext over an encrypted source. Decryptor
 * failures mirror upstream DocxDecryptError reasons. */
export interface OoxmlCrypto {
  decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array>;
  encrypt?(bytes: Uint8Array, password: string): Uint8Array | Promise<Uint8Array>;
}

/** Typed model/adapter errors — a caller branches on `code`, never on text. */
export class DocxEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DocxEngineError";
    this.code = code;
  }
}
