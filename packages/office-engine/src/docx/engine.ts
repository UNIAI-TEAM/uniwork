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

/** ParsedDoc + ParseExtras handle: the adapter treats everything outside
 * `blocks` as opaque and passes the whole object back to saveDocx, exactly
 * like upstream (patch.ts:85 ParsedDocFull). */
export interface DocxParsed {
  blocks: DocxBlock[];
  /** numId -> definition, from word/numbering.xml (upstream parse.ts:573);
   * a rendering host needs these to draw the document's real list markers. */
  numbering?: Map<string, DocxNumberingDef>;
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
  runs: DocxRun[];
  [key: string]: unknown;
}

/** NewImage — upstream types.ts:1343. */
export interface DocxNewImage {
  base64: string;
  mime: "image/png" | "image/jpeg" | "image/gif";
  widthPx: number;
  heightPx: number;
  align?: "left" | "center" | "right";
  altText?: string;
  wrap?: unknown;
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
