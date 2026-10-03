// DOCX field authoring (B7): a TOC field built from the document's headings
// and a caption paragraph carrying a SEQ field.
//
// Why a module of its own: model.ts already ran at the 500-line budget, and
// the builders are pure (no session state) — the view reuses them to lay out
// the same field XML in the editor, the model ops insert the same bytes into
// the save plan. Only plain field paragraphs are written (no w:sdt content
// control): a field paragraph is what Word itself writes for `TOC \o`, and the
// vendored parse reads it back as a tocLine FieldDisplay.
//
// The vendored engine ships equivalent writers (generateTocFieldXml /
// generateCaptionXml in docx-engine/src/generate.ts) but does not re-export
// them through the UniWork binding shim, and this lane's upstream rule keeps
// vendored source untouched — so the fragments are built here, mirroring that
// shape byte-for-byte where it matters: the dirty begin fldChar (Word rebuilds
// entries and page numbers on open), the ` TOC \o "1-N" \h \z \u ` instruction,
// TOCn paragraph styles, and the ` SEQ <label> \* ARABIC ` instruction whose
// cached result is the visible number.
import { DocxEngineError, type DocxParsed, type DocxRun } from "./engine";

/** One heading the caller resolved from the document (level 1-9). */
export interface DocxTocEntry {
  level: number;
  text: string;
  /** cached page number; omitted entries keep Word's cached result empty and
   * the dirty field lets Word fill it on open. */
  pageNo?: number;
  /** bookmark name the entry jumps to when hyperlinks are on */
  anchor?: string;
}

/** TOC switches the dialog exposes. */
export interface DocxTocOptions {
  /** highest level included in the field instruction and in the entries */
  maxLevel?: number;
  /** write the right dot-leader tab and (when known) the page number column */
  pageNumbers?: boolean;
  /** wrap the entry runs in a w:hyperlink to entry.anchor when it has one */
  hyperlinks?: boolean;
}

/** One generated TOC line: the w:p fragment plus the display fields the view
 * mirrors onto the editor node (fieldDisplayOf parses the same values back). */
export interface DocxTocLine {
  xml: string;
  level: number;
  left: string;
  right?: string;
  anchor?: string;
}

/** Word's own outline ceiling; level 0 is body text and is never an entry. */
const DOCX_TOC_MAX_LEVEL = 9;

/** Entries per TOC: a bound, not a product limit — a page-sized document stays
 * far below it, and a runaway caller fails with a typed refusal. */
const DOCX_TOC_MAX_ENTRIES = 200;

/** Right tab position of the page-number column (twips; US Letter content
 * width, same as the vendored generator). */
const TOC_TAB_POS = 9350;

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function requireMaxLevel(options: DocxTocOptions): number {
  const maxLevel = options.maxLevel ?? 3;
  if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > DOCX_TOC_MAX_LEVEL) {
    throw new DocxEngineError(
      "bad_toc_level",
      "TOC maxLevel must be an integer 1-" + DOCX_TOC_MAX_LEVEL + ", got " + String(maxLevel),
    );
  }
  return maxLevel;
}

function requireEntry(entry: DocxTocEntry): void {
  if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > DOCX_TOC_MAX_LEVEL) {
    throw new DocxEngineError(
      "bad_toc_level",
      "TOC entry level must be an integer 1-" + DOCX_TOC_MAX_LEVEL + ", got " + String(entry.level),
    );
  }
  if (typeof entry.text !== "string" || entry.text.trim().length === 0) {
    throw new DocxEngineError("empty_toc_entry", "a TOC entry needs non-blank text");
  }
  if (entry.pageNo !== undefined && (!Number.isInteger(entry.pageNo) || entry.pageNo < 1)) {
    throw new DocxEngineError("bad_toc_page", "TOC entry pageNo must be a positive integer, got " + String(entry.pageNo));
  }
}

/** Build the TOC field: one w:p per line, the first carrying the begin/instr/
 * separate runs and the last the end run (the vendored generator's layout, so
 * reloading the saved file yields a tocLine per entry and one field). */
export function buildDocxTocLines(entries: DocxTocEntry[], options: DocxTocOptions = {}): DocxTocLine[] {
  if (!Array.isArray(entries)) {
    throw new DocxEngineError("empty_toc", "insert_toc needs an entry list");
  }
  const maxLevel = requireMaxLevel(options);
  const pageNumbers = options.pageNumbers !== false;
  const hyperlinks = options.hyperlinks !== false;
  for (const entry of entries) requireEntry(entry);
  const included = entries.filter((entry) => entry.level <= maxLevel);
  if (included.length === 0) {
    throw new DocxEngineError("empty_toc", "no heading matches levels 1-" + maxLevel + "; nothing to insert");
  }
  if (included.length > DOCX_TOC_MAX_ENTRIES) {
    throw new DocxEngineError(
      "toc_too_large",
      "a TOC holds at most " + DOCX_TOC_MAX_ENTRIES + " entries, got " + included.length,
    );
  }
  const begin =
    '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-' + maxLevel + '" \\h \\z \\u </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
  const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const proofed = (inner: string) => "<w:r><w:rPr><w:noProof/></w:rPr>" + inner + "</w:r>";
  return included.map((entry, at) => {
    const level = Math.min(entry.level, DOCX_TOC_MAX_LEVEL);
    const pPr =
      '<w:pPr><w:pStyle w:val="TOC' + level + '"/>' +
      (pageNumbers ? '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="' + TOC_TAB_POS + '"/></w:tabs>' : "") +
      "<w:rPr><w:noProof/></w:rPr></w:pPr>";
    const title = proofed('<w:t xml:space="preserve">' + escapeXmlText(entry.text) + "</w:t>");
    const page =
      pageNumbers
        ? proofed("<w:tab/>") + (entry.pageNo !== undefined ? proofed("<w:t>" + entry.pageNo + "</w:t>") : "")
        : "";
    const runs = title + page;
    const body = hyperlinks && entry.anchor ? '<w:hyperlink w:anchor="' + escapeXmlAttr(entry.anchor) + '">' + runs + "</w:hyperlink>" : runs;
    const first = at === 0 ? begin : "";
    const last = at === included.length - 1 ? end : "";
    return {
      xml: "<w:p>" + pPr + first + body + last + "</w:p>",
      level,
      left: entry.text,
      ...(pageNumbers && entry.pageNo !== undefined ? { right: String(entry.pageNo) } : {}),
      ...(entry.anchor ? { anchor: entry.anchor } : {}),
    };
  });
}

/** The SEQ instruction a caption's number run carries; the view writes the
 * same string into the editor's inline-field mark, so a caption created in the
 * browser and one inserted through the model op save the same field. */
export function docxCaptionInstr(label: string): string {
  return " SEQ " + label + " \\* ARABIC ";
}

function requireCaptionLabel(label: string): void {
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new DocxEngineError("empty_caption_label", "a caption needs a non-blank label");
  }
}

/** Runs of one caption paragraph: `<label> <SEQ label> <text>`. The number run
 * carries the inline field (cached result text + dirty begin), so the vendored
 * writer emits a real SEQ field and Word renumbers all captions on open. */
export function docxCaptionRuns(label: string, number: number, text: string): DocxRun[] {
  requireCaptionLabel(label);
  if (!Number.isInteger(number) || number < 1) {
    throw new DocxEngineError("bad_caption_number", "a caption number must be a positive integer, got " + String(number));
  }
  const runs: DocxRun[] = [
    { text: label + " " },
    { text: String(number), instrField: docxCaptionInstr(label), fldDirty: true },
  ];
  if (typeof text === "string" && text.length > 0) runs.push({ text: " " + text });
  return runs;
}

const SEQ_FIELD_RE = (label: string): RegExp =>
  // field code in a run-level instrText or a w:fldSimple/@w:instr attribute
  new RegExp('(?:<w:instrText[^>]*>|w:instr=")\\s*SEQ\\s+' + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])");

/** Count the SEQ fields of one label in a block's XML (cached results and
 * unresolved fields alike count — the next number depends on both). */
function countDocxCaptionFields(xml: string, label: string): number {
  requireCaptionLabel(label);
  let count = 0;
  const re = new RegExp(SEQ_FIELD_RE(label).source, "g");
  while (re.exec(xml) !== null) count += 1;
  return count;
}

/** The document's own caption count for a label: every parsed block that can
 * be regenerated (hidden blocks included — they are saved back) is scanned. */
export function nextDocxCaptionNumber(parsed: DocxParsed, label: string): number {
  let count = 0;
  for (const block of parsed.blocks) {
    if (typeof block.originalXml === "string") count += countDocxCaptionFields(block.originalXml, label);
  }
  return count + 1;
}

function docxTocXml(entries: DocxTocEntry[], options?: DocxTocOptions): string {
  return buildDocxTocLines(entries, options)
    .map((line) => line.xml)
    .join("");
}

/** One save-plan row as this module sees it: the model's PlanEntry union
 * satisfies it structurally, and the module only ever touches a row it
 * inserted itself. */
export interface DocxFieldRow {
  source: string;
  xml?: string;
  block?: { runs?: DocxRun[] };
}

/** The session-plan surface the field ops mutate; the model supplies it. */
export interface DocxFieldPlan {
  /** Insert one xml row at a plan position and return it (the host validates
   * the index and marks the session dirty). */
  insertXml(index: number, xml: string): DocxFieldRow;
  /** Insert one generated paragraph row at a plan position. */
  insertParagraph(index: number, runs: DocxRun[]): void;
  /** The live plan rows in order (read-only view). */
  rows(): ReadonlyArray<DocxFieldRow>;
  /** Mark the session dirty — touched + a revision bump for one edit. */
  edited(): void;
}

/** The TOC/caption edits of one session. TOC rows are tracked weakly by
 * identity, so a rebase (which builds a new plan) drains them without a
 * clear call and an update can never reach a parse-loaded original. */
export class DocxFieldEdits {
  private readonly tocRows = new WeakSet<DocxFieldRow>();

  constructor(private readonly plan: DocxFieldPlan) {}

  /** Insert a TOC field built from the caller's heading list (B7): one plan
   * row holds every w:p of the field, so an update rewrites it as a unit and
   * the begin/end fldChars stay paired. */
  insertToc(index: number, entries: DocxTocEntry[], options?: DocxTocOptions): void {
    const row = this.plan.insertXml(index, docxTocXml(entries, options));
    this.tocRows.add(row);
  }

  /** Regenerate every TOC this session inserted. The field's begin fldChar
   * stays dirty, so Word rebuilds entries and page numbers on open. A TOC
   * that came from the parse is refused (`no_toc`): its blocks are originals,
   * and an untouched original saves byte-identical by rule. */
  updateToc(entries: DocxTocEntry[], options?: DocxTocOptions): void {
    const targets = this.plan.rows().filter((row) => this.tocRows.has(row));
    if (targets.length === 0) {
      throw new DocxEngineError("no_toc", "no table of contents was inserted in this session; nothing to update");
    }
    const xml = docxTocXml(entries, options);
    for (const target of targets) target.xml = xml;
    this.plan.edited();
  }

  /** Insert a caption paragraph (B7): label + SEQ field + text. The number is
   * the next one for the label — the parsed document's own captions plus the
   * captions this session already inserted. */
  insertCaption(parsed: DocxParsed, index: number, label: string, text: string): void {
    const number = nextDocxCaptionNumber(parsed, label) + this.sessionCaptionCount(label);
    this.plan.insertParagraph(index, docxCaptionRuns(label, number, text));
  }

  /** Apply one field op; the model dispatches here from its edit channel. */
  applyEdit(parsed: DocxParsed, edit: DocxFieldEdit): void {
    switch (edit.op) {
      case "insert_toc":
        return this.insertToc(edit.index, edit.entries, edit.options);
      case "update_toc":
        return this.updateToc(edit.entries, edit.options);
      case "insert_caption":
        return this.insertCaption(parsed, edit.index, edit.label, edit.text);
    }
  }

  private sessionCaptionCount(label: string): number {
    const instr = docxCaptionInstr(label);
    let count = 0;
    for (const row of this.plan.rows()) {
      if (row.source !== "generated") continue;
      for (const run of row.block?.runs ?? []) {
        if (run.instrField === instr) count += 1;
      }
    }
    return count;
  }
}

/** The field ops the model's DocxEdit union carries (B7). */
export type DocxFieldEdit =
  | { op: "insert_toc"; index: number; entries: DocxTocEntry[]; options?: DocxTocOptions }
  | { op: "update_toc"; entries: DocxTocEntry[]; options?: DocxTocOptions }
  | { op: "insert_caption"; index: number; label: string; text: string };

export function isDocxFieldEdit(edit: { op: string }): edit is DocxFieldEdit {
  return edit.op === "insert_toc" || edit.op === "update_toc" || edit.op === "insert_caption";
}
