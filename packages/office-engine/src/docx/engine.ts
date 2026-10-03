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

/** CustomNumberingLevel — upstream blank.ts:89 verbatim. One authored level of
 * a multilevel/bullet/numbering definition; the save writes them with
 * w:ilvl = array index (`customLevels`, blank.ts:105). */
export interface DocxNumberingLevelSpec {
  /** w:numFmt: decimal/bullet/lowerLetter/upperRoman/chineseCountingThousand… */
  numFmt: string;
  /** w:lvlText: a pattern like "%1." or a literal bullet symbol */
  lvlText: string;
  /** w:ind w:left (twips) */
  indentLeft: number;
  /** w:ind w:hanging (twips; the writer defaults 360) */
  hanging?: number;
  /** w:start (the writer defaults 1) */
  start?: number;
  [key: string]: unknown;
}

/** A brand-new numbering definition: upstream SaveOptions.numbering.newDefs
 * (patch.ts:167). The save assigns the abstractNum id and writes
 * abstractNum + w:num; the doc's own bytes for the part stay untouched. */
export interface DocxNewNumberingDef {
  numId: string;
  kind: "bullet" | "ordered";
  /** Custom levels, array index = w:ilvl (max 9); absent = blank-template style */
  levels?: DocxNumberingLevelSpec[];
}

/** A restart: upstream SaveOptions.numbering.restartNums (patch.ts:168). A new
 * w:num pointing at an EXISTING abstractNum with w:lvlOverride/w:startOverride;
 * body items must carry the new numId for the restart to show. */
export interface DocxRestartNumbering {
  numId: string;
  abstractNumId: string;
  /** ilvl -> startOverride value */
  startOverrides: Record<number, number>;
}

/** Append-only numbering-part edits (B5): newDefs/restartNums reach the
 * vendored writer's SaveOptions.numbering. undefined keeps the part
 * byte-identical. */
export interface DocxNumberingOptions {
  newDefs?: DocxNewNumberingDef[];
  restartNums?: DocxRestartNumbering[];
}

/** word/settings.xml w:documentProtection — the editing restriction (C3).
 * Upstream types.ts:2003; the hash/salt/spinCount/algorithmSid fields carry
 * the Word 2013+ iterated-SHA-512 verifier of the restriction password. */
export interface DocProtection {
  /** w:edit value, e.g. "readOnly" | "comments" | "trackedChanges" | "forms" */
  edit: string;
  /** w:enforcement="1" — the restriction is active */
  enforced: boolean;
  /** password hash (base64); absent = the restriction carries no password */
  hash?: string;
  /** salt (base64) */
  salt?: string;
  /** w:cryptSpinCount; Word's default is 100000 */
  spinCount?: number;
  /** w:cryptAlgorithmSid; 14 = SHA-512 (the only supported value) */
  algorithmSid?: number;
}

/** word/settings.xml w:writeProtection — password to modify / read-only
 * recommended (upstream types.ts:2019). Honor-system: it never encrypts. */
export interface WriteProtection {
  /** w:recommended="1" — Word suggests opening read-only */
  recommended?: boolean;
  /** password-to-modify hash (base64, same SHA-512 scheme); absent = none */
  hash?: string;
  /** salt (base64) */
  salt?: string;
  /** w:cryptSpinCount; Word's default is 100000 */
  spinCount?: number;
  /** w:cryptAlgorithmSid; 14 = SHA-512 (the only supported value) */
  algorithmSid?: number;
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
  /** Editing restriction from word/settings.xml, null when none (upstream
   * types.ts:2148); optional so a light/fake parse stays valid. */
  protection?: DocProtection | null;
  /** Password-to-modify / read-only-recommended from word/settings.xml
   * (upstream types.ts:2150), null when none. */
  writeProtection?: WriteProtection | null;
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

/** Text watermark — upstream WatermarkSpec (watermark.ts:87); a bare string
 * would be the text alone. The save writes/removes the VML watermark in the
 * default page header (patch.ts:211). Picture watermarks are upstream-
 * supported but not surfaced by B6. */
export interface DocxWatermark {
  text: string;
  fontFamily?: string;
  /** hex without '#' (upstream default: silver) */
  colorHex?: string;
  /** 0..1 fill opacity (upstream default 0.5) */
  opacity?: number;
  /** rotated 315° like Word's diagonal layout (upstream default true) */
  diagonal?: boolean;
  bold?: boolean;
  italic?: boolean;
}

/** Theme font pair — upstream ThemeFonts (types.ts:2049), the subset the save
 * writes (applyThemeFonts, theme.ts:73). */
export interface DocxThemeFonts {
  major: string;
  minor: string;
  /** a:ea typeface, written to both font groups when present */
  eastAsia?: string;
}

/** Writeable theme colour slots — upstream ThemeColors (types.ts:2102).
 * applyThemeColors (theme.ts:212) rewrites the six accents + dk2/lt2 and the
 * scheme name; dk1/lt1/hlink/folHlink stay read-only. Hex without '#'. */
export interface DocxThemeColors {
  name?: string;
  dk2?: string;
  lt2?: string;
  accent1?: string;
  accent2?: string;
  accent3?: string;
  accent4?: string;
  accent5?: string;
  accent6?: string;
}

/** Page borders of one section: one style on all four sides, written as
 * w:pgBorders in the section's w:sectPr. The vendored save carries no option
 * for them, so B6 rewrites the sectPr slice through the section seam. */
export interface DocxPageBorders {
  /** ST_Border line style: single, double, dashed, dotted, wave, … */
  style: string;
  /** w:sz in eighths of a point (2-96; upstream default 4) */
  widthEighths?: number;
  /** w:color hex without '#'; absent writes "auto" */
  colorHex?: string;
  /** w:space: distance from the offset base in points (upstream default 24) */
  spacePt?: number;
  /** w:offsetFrom; absent keeps Word's default ("text") */
  offsetFrom?: "page" | "text";
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
  /** Replace the trailing hidden body w:sectPr block with this XML before the
   * field-level options apply (upstream patch.ts:116). B4 page setup rewrites
   * the final section's page-setup fields through this seam; undefined keeps
   * the block byte-identical. */
  trailingSectPr?: string;
  /** Append-only numbering-part edits (upstream patch.ts:165): newDefs and
   * restartNums are appended to word/numbering.xml — the part is created from
   * the blank template when missing — while every existing entry keeps its
   * bytes. undefined keeps the part byte-identical (B5). */
  numbering?: DocxNumberingOptions;
  header?: DocxHeaderFooter;
  footer?: DocxHeaderFooter;
  headerFirst?: DocxHeaderFooter;
  footerFirst?: DocxHeaderFooter;
  headerEven?: DocxHeaderFooter;
  footerEven?: DocxHeaderFooter;
  titlePg?: boolean;
  evenAndOddHeaders?: boolean;
  /** Page colour: hex without '#' to set, null to remove, undefined to keep
   * (upstream patch.ts:125 — w:background + the settings display flag). */
  pageColor?: string | null;
  /** Default-header watermark: a spec sets/replaces it, null removes it,
   * undefined keeps the header's own (upstream patch.ts:211). */
  watermark?: DocxWatermark | null;
  /** Theme font pair / colour scheme: patches (or creates)
   * word/theme/theme1.xml; undefined keeps the part byte-identical
   * (upstream patch.ts:223-226). */
  themeFonts?: DocxThemeFonts;
  themeColors?: DocxThemeColors;
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
  /** Editing restriction (C3, upstream patch.ts:195): a spec sets/replaces
   * w:documentProtection, null removes it, undefined keeps the part
   * byte-identical. */
  protection?: DocProtection | null;
  /** Password to modify / read-only recommended (C3, upstream patch.ts:197):
   * a spec sets/replaces w:writeProtection, null removes it, undefined keeps
   * the part byte-identical. */
  writeProtection?: WriteProtection | null;
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
