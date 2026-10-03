// DOCX session model — the editable document state an open() produces.
//
// The model owns a save PLAN, not a re-render: every entry is either an
// original block (kept byte-identical by upstream patch.ts:217 ff.) or a
// generated/xml/image/chart replacement the editor actually made. Save
// serialises this plan — never the input bytes with a success claim.
// Semantics ported from the G0 oracle (e2e/office-g0/engine-docx.mts):
// visibleIndexes = every legal original (the only set plans may draw from),
// editableIndexes = visible paragraphs, hidden blocks appended automatically
// by saveDocx.
import {
  DocxEngineError, requireDocxNewChart,
  type DocxBlock,
  type DocxCommentInfo,
  type DocxGeneratedBlock,
  type DocxHeaderFooter,
  type DocxNewChart,
  type DocxNewImage,
  type DocxNewNumberingDef,
  type DocxNoteInfo,
  type DocxNoteKind,
  type DocxParsed,
  type DocxRestartNumbering,
  type DocxRun,
  type DocxSaveBlock,
  type DocxSaveOptions,
} from "./engine";
import { DocxFieldEdits, isDocxFieldEdit, type DocxFieldEdit } from "./fields";
import { DocxNumberingEdits } from "./numbering";
import { visibleIndexes } from "./plan-view";
import { DocxPageDecorState, isPageDecorEdit, type DocxPageBorders, type DocxPageDecorEdit, type DocxThemeColors, type DocxThemeFonts, type DocxWatermark } from "./page-decor";
import { cloneNote, requireCommentEntry, requireImageBytes, requireNote } from "./payloads";
import { DocxProtectionEdits, isProtectionOp, type DocxProtectionOp } from "./protection";
import {
  applySectionProperties,
  docxSections,
  originalXmlOf,
  requireSectionProperties,
  type DocxSectionProperties,
  type DocxSectionSlice,
} from "./section-properties";

export {
  applySectionProperties,
  DOCX_SECTION_MAX_COLUMNS,
  docxSections,
  readSectionSnapshot,
  requireSectionProperties,
  type DocxSectionOrientation,
  type DocxSectionProperties,
  type DocxSectionSlice,
  type DocxSectionSnapshot,
  type DocxSectionStartType,
} from "./section-properties";
// B6 page-decoration surface: readPageDecor/readPageBorders/applyPageBorders,
// the border style list and the op/options types.
export * from "./page-decor";
// The session-plan view helpers moved to ./plan-view (B7, 500-line budget).
export { editableIndexes, plainText, visibleIndexes } from "./plan-view";

/** One plan row: an original block ref, or the replacement the model carries. */
type PlanEntry =
  | { source: "original"; docxIndex: number }
  | { source: "generated"; block: DocxGeneratedBlock }
  | { source: "xml"; xml: string; docxIndex?: number; replaceImage?: { base64: string; mime: DocxNewImage["mime"] } }
  | { source: "image"; image: DocxNewImage }
  | { source: "chart"; chart: DocxNewChart; extentPx?: { w: number; h: number } };

export type DocxEdit =
  | { op: "set_paragraph_text"; docxIndex: number; runs: DocxRun[] }
  | { op: "insert_generated"; index: number; block: DocxGeneratedBlock }
  | { op: "replace_block_xml"; docxIndex: number; xml: string; replaceImage?: { base64: string; mime: DocxNewImage["mime"] } }
  | { op: "insert_xml"; index: number; xml: string }
  | { op: "insert_image"; index: number; image: DocxNewImage }
  | { op: "insert_chart"; index: number; chart: DocxNewChart; extentPx?: { w: number; h: number } }
  | { op: "remove_block"; docxIndex: number }
  | { op: "set_header_footer"; slot: DocxHfSlot; hf: DocxHeaderFooter | null }
  | { op: "set_title_pg"; value: boolean }
  | { op: "set_even_odd_headers"; value: boolean }
  | { op: "set_comments"; comments: DocxCommentInfo[] }
  | { op: "set_notes"; kind: DocxNoteKind; notes: DocxNoteInfo[] }
  | { op: "set_section_properties"; sectionIndex: number; properties: DocxSectionProperties }
  | { op: "insert_numbering_def"; def: DocxNewNumberingDef }
  | { op: "restart_numbering"; restart: DocxRestartNumbering }
  | DocxProtectionOp
  | DocxPageDecorEdit
  | DocxFieldEdit;

export type DocxHfSlot = "header" | "footer" | "headerFirst" | "footerFirst" | "headerEven" | "footerEven";

export class DocxSessionModel {
  /** The engine's parse handle — passed back to saveDocx untouched. */
  parsed: DocxParsed;
  private plan: PlanEntry[];
  private options: DocxSaveOptions = {};
  /** Per-section page-setup edits (B4), keyed by 0-based document-order
   * section index. Applied against the final plan at savePlan() time — the
   * plan may still move after the edit, and the final section's slice has no
   * plan entry at all (it rides SaveOptions.trailingSectPr). */
  private sectionEdits = new Map<number, DocxSectionProperties>();
  /** Pending numbering-part edits (B5) — definitions and restart nums the save
   * appends to word/numbering.xml; see ./numbering. Rebase replaces it. */
  private numbering: DocxNumberingEdits;
  private touched = false;
  /** Monotonic edit counter — a two-save chain can prove the base advanced. */
  revision = 0;
  /** Pending page-decoration edits (B6); see ./page-decor. */
  private readonly pageDecor = new DocxPageDecorState(() => { this.touched = true; this.revision += 1; });
  /** Pending protection edits (C3); see ./protection. */
  private readonly protection = new DocxProtectionEdits(() => { this.touched = true; this.revision += 1; });
  /** TOC/caption edits (B7); see ./fields. The plan surface below is the only
   * way the field module reaches this session. */
  private readonly fieldEdits = new DocxFieldEdits({
    insertXml: (index, xml) => {
      const row: PlanEntry = { source: "xml", xml };
      this.insertAt(index, row);
      return row;
    },
    insertParagraph: (index, runs) => this.insertAt(index, { source: "generated", block: { type: "paragraph", runs } }),
    rows: () => this.plan,
    edited: () => { this.touched = true; this.revision += 1; },
  });

  constructor(parsed: DocxParsed) {
    this.parsed = parsed;
    this.plan = visibleIndexes(parsed).map((docxIndex) => ({ source: "original", docxIndex }));
    this.numbering = new DocxNumberingEdits(parsed.numbering instanceof Map ? parsed.numbering : undefined);
  }

  get blocks(): DocxBlock[] {
    return this.parsed.blocks;
  }

  get isDirty(): boolean {
    return this.touched;
  }

  /** Position of a docxIndex inside the current plan. */
  private planIndexOf(docxIndex: number, code = "bad_index"): number {
    const at = this.plan.findIndex((e) => e.source === "original" && e.docxIndex === docxIndex);
    if (at < 0) throw new DocxEngineError(code, "docxIndex " + docxIndex + " is not in the save plan");
    return at;
  }

  /** Resolve a visible paragraph target or refuse — a rejected target never
   * reaches the plan, mirroring requireParagraphTarget in the G0 oracle. */
  private requireParagraphTarget(docxIndex: number): DocxBlock {
    if (!Number.isInteger(docxIndex)) {
      throw new DocxEngineError("bad_index", "docxIndex must be an integer, got " + String(docxIndex));
    }
    const hits = this.parsed.blocks.filter((b) => b.docxIndex === docxIndex);
    const block = hits[0];
    if (block === undefined) {
      throw new DocxEngineError("bad_index", "no top-level block has docxIndex " + docxIndex);
    }
    if (hits.length > 1) {
      throw new DocxEngineError("ambiguous_index", "docxIndex " + docxIndex + " matches " + hits.length + " blocks");
    }
    if (block.hidden) {
      throw new DocxEngineError("hidden_target", "docxIndex " + docxIndex + " is hidden, not an editable paragraph");
    }
    if (block.type !== "paragraph") {
      throw new DocxEngineError(
        "unsupported_target",
        "docxIndex " + docxIndex + " is a " + block.type + " block; set_paragraph_text edits paragraphs only",
      );
    }
    return block;
  }

  /** Replace a visible paragraph's runs with a generated block. */
  setParagraphText(docxIndex: number, runs: DocxRun[]): void {
    this.requireParagraphTarget(docxIndex);
    if (!Array.isArray(runs) || runs.length === 0 || runs.some((r) => typeof r?.text !== "string" || r.text.length === 0)) {
      throw new DocxEngineError("empty_text", "set_paragraph_text needs at least one run with non-empty text");
    }
    this.plan[this.planIndexOf(docxIndex)] = {
      source: "generated",
      block: { type: "paragraph", runs },
    };
    this.touched = true;
    this.revision += 1;
  }

  /** Replace an original block with a self-contained OOXML fragment (the
   * table/image edit path: the editor supplies the fragment, docxIndex marks
   * the source block, replaceImage swaps picture bytes in place). */
  replaceBlockXml(docxIndex: number, xml: string, replaceImage?: { base64: string; mime: DocxNewImage["mime"] }): void {
    const block = this.parsed.blocks.find((b) => b.docxIndex === docxIndex);
    if (!block) throw new DocxEngineError("bad_index", "no block has docxIndex " + docxIndex);
    if (block.hidden) throw new DocxEngineError("hidden_target", "docxIndex " + docxIndex + " is hidden");
    if (typeof xml !== "string" || xml.length === 0) {
      throw new DocxEngineError("empty_xml", "replace_block_xml needs a non-empty fragment");
    }
    if (replaceImage) requireImageBytes(replaceImage, "replace_block_xml replaceImage");
    this.plan[this.planIndexOf(docxIndex)] = { source: "xml", xml, docxIndex, ...(replaceImage ? { replaceImage } : {}) };
    this.touched = true;
    this.revision += 1;
  }

  /** Insert at a plan position (0..len). Positions are plan indexes, not
   * docxIndex values — inserts carry no original index. */
  private insertAt(index: number, entry: PlanEntry): void {
    if (!Number.isInteger(index) || index < 0 || index > this.plan.length) {
      throw new DocxEngineError("bad_index", "insert index " + index + " out of range 0-" + this.plan.length);
    }
    this.plan.splice(index, 0, entry);
    this.touched = true;
    this.revision += 1;
  }

  insertGenerated(index: number, block: DocxGeneratedBlock): void {
    if (!block || !Array.isArray(block.runs) || block.runs.length === 0) {
      throw new DocxEngineError("empty_text", "insert_generated needs a block with runs");
    }
    this.insertAt(index, { source: "generated", block });
  }

  insertXml(index: number, xml: string): void {
    if (typeof xml !== "string" || xml.length === 0) {
      throw new DocxEngineError("empty_xml", "insert_xml needs a non-empty fragment");
    }
    this.insertAt(index, { source: "xml", xml });
  }

  insertImage(index: number, image: DocxNewImage): void {
    requireImageBytes(image, "insert_image");
    if (!Number.isFinite(image.widthPx) || !Number.isFinite(image.heightPx) || image.widthPx <= 0 || image.heightPx <= 0) {
      throw new DocxEngineError(
        "bad_image_size",
        "insert_image needs positive widthPx/heightPx, got " + String(image.widthPx) + "x" + String(image.heightPx),
      );
    }
    const offset = image.posOffsetEmu;
    if (offset && (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))) {
      throw new DocxEngineError("bad_image_position", "insert_image posOffsetEmu needs finite x/y");
    }
    this.insertAt(index, { source: "image", image });
  }

  insertChart(index: number, chart: DocxNewChart, extentPx?: { w: number; h: number }): void {
    requireDocxNewChart(chart, extentPx);
    this.insertAt(index, { source: "chart", chart, ...(extentPx ? { extentPx } : {}) });
  }

  /** Drop a block from the plan — deleted content, not hidden (hidden is an
   * original state the engine re-appends; remove is an edit decision). */
  removeBlock(docxIndex: number): void {
    this.plan.splice(this.planIndexOf(docxIndex), 1);
    this.touched = true;
    this.revision += 1;
  }

  setHeaderFooter(slot: DocxHfSlot, hf: DocxHeaderFooter | null): void {
    if (hf === null) {
      // Upstream has no explicit "remove header" flag; an empty-text hf is the
      // honest carrier for clearing, kept visible instead of invented.
      this.options[slot] = { text: "" };
    } else {
      this.options[slot] = hf;
    }
    this.touched = true;
    this.revision += 1;
  }

  setTitlePg(value: boolean): void {
    this.options.titlePg = value;
    this.touched = true;
    this.revision += 1;
  }

  setEvenOddHeaders(value: boolean): void {
    this.options.evenAndOddHeaders = value;
    this.touched = true;
    this.revision += 1;
  }

  /** B6 page decoration: colour/watermark/theme become SaveOptions; the
   * section's border box rides the section rewrites. */
  setPageColor(color: string | null): void { this.pageDecor.setPageColor(color); }
  setWatermark(watermark: DocxWatermark | null): void { this.pageDecor.setWatermark(watermark); }
  setThemeFonts(fonts: DocxThemeFonts): void { this.pageDecor.setThemeFonts(fonts); }
  setThemeColors(colors: DocxThemeColors): void { this.pageDecor.setThemeColors(colors); }
  setPageBorders(sectionIndex: number, borders: DocxPageBorders | null): void { this.pageDecor.setPageBorders(this.parsed, sectionIndex, borders); }

  /** Set page-setup fields of one section. `sectionIndex` is the section's
   * 0-based document-order position (docxSections/readSections order), never a
   * block docxIndex. Fields merge: an absent field keeps the section's current
   * value. The final section is written through SaveOptions.trailingSectPr; an
   * earlier section's sectPr is rewritten inside its section-break paragraph. */
  setSectionProperties(sectionIndex: number, properties: DocxSectionProperties): void {
    if (!Number.isInteger(sectionIndex)) {
      throw new DocxEngineError("bad_section_index", "sectionIndex must be an integer, got " + String(sectionIndex));
    }
    const sections = docxSections(this.parsed);
    const target = sections[sectionIndex];
    if (!target) {
      throw new DocxEngineError("bad_section_index", "no section has index " + sectionIndex + " (" + sections.length + " sections)");
    }
    if (target.sectPrXml.length === 0) {
      throw new DocxEngineError("no_section_sectPr", "section " + sectionIndex + " carries no w:sectPr to rewrite");
    }
    requireSectionProperties(properties);
    this.sectionEdits.set(sectionIndex, { ...this.sectionEdits.get(sectionIndex), ...properties });
    this.touched = true;
    this.revision += 1;
  }

  /** Append a brand-new numbering definition (B5): the save writes a new
   * abstractNum + w:num. The payload oracle and the numId collision rules live
   * in ./numbering. */
  insertNumberingDef(def: DocxNewNumberingDef): void {
    this.numbering.insert(def);
    this.touched = true;
    this.revision += 1;
  }

  /** Append a restart num over an EXISTING abstractNum (B5). */
  restartNumbering(restart: DocxRestartNumbering): void {
    this.numbering.restart(restart);
    this.touched = true;
    this.revision += 1;
  }

  /** Plan position of a section's closing block. The exact docxIndex wins;
   * when the editor replaced that block, the replacement still carries the
   * section's own sectPr bytes (generated pPr or xml fragment), so the first
   * unconsumed carrier matches. -1 when the break paragraph is gone. */
  private planIndexForSection(section: DocxSectionSlice, consumed: Set<number>): number {
    const exact = this.plan.findIndex(
      (entry, at) => !consumed.has(at) && "docxIndex" in entry && entry.docxIndex === section.breakDocxIndex,
    );
    if (exact >= 0) return exact;
    if (section.sectPrXml.length === 0) return -1;
    return this.plan.findIndex((entry, at) => {
      if (consumed.has(at)) return false;
      if (entry.source === "generated") {
        const rawPPr = (entry.block as { rawPPr?: unknown }).rawPPr;
        return typeof rawPPr === "string" && rawPPr.includes(section.sectPrXml);
      }
      return entry.source === "xml" && entry.xml.includes(section.sectPrXml);
    });
  }

  /** Resolve this save's section rewrites: plan position -> sectPr swap. The
   * final section has no plan entry (saveDocx appends the hidden block), so
   * its bytes ride `options.trailingSectPr` instead. */
  private sectionRewrites(options: DocxSaveOptions): Map<number, { from: string; to: string }> {
    const rewrites = new Map<number, { from: string; to: string }>();
    const borderIndexes = this.pageDecor.borderIndexes();
    if (this.sectionEdits.size === 0 && borderIndexes.length === 0) return rewrites;
    const sections = docxSections(this.parsed);
    const consumed = new Set<number>();
    for (const sectionIndex of [...new Set([...this.sectionEdits.keys(), ...borderIndexes])].sort((a, b) => a - b)) {
      const section = sections[sectionIndex];
      if (!section || section.sectPrXml.length === 0) continue;
      const to = this.pageDecor.applyBorders(sectionIndex, applySectionProperties(section.sectPrXml, this.sectionEdits.get(sectionIndex) ?? {}));
      if (to === section.sectPrXml) continue;
      if (section.breakDocxIndex === null) {
        options.trailingSectPr = section.blockXml.replace(section.sectPrXml, to);
        continue;
      }
      const at = this.planIndexForSection(section, consumed);
      if (at < 0) continue;
      consumed.add(at);
      rewrites.set(at, { from: section.sectPrXml, to });
    }
    return rewrites;
  }

  /** The authoritative comment list: the parse's own list until an edit
   * replaces it. An untouched list never reaches SaveOptions, so a save keeps
   * word/comments.xml byte-identical (the byte-preservation rule). */
  get comments(): DocxCommentInfo[] {
    const own = this.options.comments;
    if (own) return own.map((comment) => ({ ...comment }));
    const parsed = this.parsed.comments;
    return Array.isArray(parsed) ? parsed.map((comment) => ({ ...comment })) : [];
  }

  /** Replace the authoritative list — upstream SaveOptions.comments: the save
   * regenerates word/comments.xml from it and removes body markers for ids no
   * longer present. Ids must be unique and every reply must point at a listed
   * parent; the caller's array is copied, never aliased into the plan. Entries
   * are only structurally checked (see requireCommentEntry): a list seeded from
   * the parse carries its own author-less/empty-text entries and must reach the
   * save unchanged. */
  setComments(comments: DocxCommentInfo[]): void {
    if (!Array.isArray(comments)) {
      throw new DocxEngineError("bad_comment", "set_comments needs a comment list");
    }
    const ids = new Set<string>();
    for (const comment of comments) {
      requireCommentEntry(comment, "set_comments", false);
      if (ids.has(comment.id)) throw new DocxEngineError("duplicate_comment_id", "comment id " + comment.id + " appears twice");
      ids.add(comment.id);
    }
    for (const comment of comments) {
      if (comment.parentId !== undefined && !ids.has(comment.parentId)) {
        throw new DocxEngineError("unknown_comment", "reply " + comment.id + " points at missing parent " + comment.parentId);
      }
    }
    this.options.comments = comments.map((comment) => ({ ...comment }));
    this.touched = true;
    this.revision += 1;
  }

  /** Every id in a comment's thread below it (the id plus its whole reply
   * subtree, transitively — files can carry replies to replies). */
  private threadSubtree(comments: readonly DocxCommentInfo[], id: string): Set<string> {
    const ids = new Set([id]);
    let size = 0;
    while (size !== ids.size) {
      size = ids.size;
      for (const comment of comments) {
        if (comment.parentId !== undefined && ids.has(comment.parentId)) ids.add(comment.id);
      }
    }
    return ids;
  }

  /** Append one comment (the caller allocates the id; the save assigns the
   * commentsExtended paraId for new entries). */
  addComment(comment: DocxCommentInfo): void {
    requireCommentEntry(comment, "add_comment", true);
    if (this.comments.some((c) => c.id === comment.id)) throw new DocxEngineError("duplicate_comment_id", "comment id " + comment.id + " already exists");
    this.setComments([...this.comments, { ...comment }]);
  }

  /** Append a reply anchored to `parentId` (Word: a reply shares the parent
   * comment's document range, so the anchor is the parent's). */
  replyToComment(parentId: string, reply: DocxCommentInfo): void {
    requireCommentEntry(reply, "reply_to_comment", true);
    const list = this.comments;
    if (!list.some((c) => c.id === parentId)) throw new DocxEngineError("unknown_comment", "no comment " + parentId + " to reply to");
    if (reply.parentId !== undefined && reply.parentId !== parentId) {
      throw new DocxEngineError("bad_comment", "reply " + reply.id + " carries parentId " + reply.parentId + ", not " + parentId);
    }
    if (list.some((c) => c.id === reply.id)) throw new DocxEngineError("duplicate_comment_id", "comment id " + reply.id + " already exists");
    this.setComments([...list, { ...reply, parentId }]);
  }

  /** Resolve/reopen a thread: the comment and every reply below it share the
   * flag (Word resolves a thread as a unit). */
  setCommentResolved(id: string, done: boolean): void {
    const list = this.comments;
    if (!list.some((c) => c.id === id)) throw new DocxEngineError("unknown_comment", "no comment " + id + " to resolve");
    const ids = this.threadSubtree(list, id);
    this.setComments(list.map((c) => (ids.has(c.id) ? { ...c, done } : c)));
  }

  /** Delete a comment; its whole reply subtree goes with it (Word deletes the
   * thread). The body markers disappear because the save strips markers for ids
   * no longer in the list (upstream removeDeletedCommentMarkers). */
  deleteComment(id: string): void {
    const list = this.comments;
    if (!list.some((c) => c.id === id)) throw new DocxEngineError("unknown_comment", "no comment " + id + " to delete");
    const gone = this.threadSubtree(list, id);
    this.setComments(list.filter((c) => !gone.has(c.id)));
  }

  private requireNoteKind(kind: DocxNoteKind, what: string): void {
    if (kind !== "footnote" && kind !== "endnote") {
      throw new DocxEngineError("bad_note_kind", what + " kind " + String(kind) + " is not footnote/endnote");
    }
  }

  /** The authoritative note list of a kind: the edit's own list until one
   * replaces it, else the parse's list. An untouched list never reaches
   * SaveOptions, so a save keeps the notes part byte-identical. */
  notes(kind: DocxNoteKind): DocxNoteInfo[] {
    this.requireNoteKind(kind, "notes");
    const own = kind === "footnote" ? this.options.footnotes : this.options.endnotes;
    if (own) return own.map(cloneNote);
    const parsed = kind === "footnote" ? this.parsed.footnotes : this.parsed.endnotes;
    return Array.isArray(parsed) ? parsed.map(cloneNote) : [];
  }

  /** Replace the authoritative list — upstream SaveOptions.footnotes/endnotes:
   * the save regenerates the part from it in list order, and numbers follow
   * that order, so a delete renumbers the survivors. Ids must be unique within
   * the kind. */
  setNotes(kind: DocxNoteKind, notes: DocxNoteInfo[]): void {
    this.requireNoteKind(kind, "set_notes");
    if (!Array.isArray(notes)) {
      throw new DocxEngineError("bad_note", "set_notes needs a note list");
    }
    const ids = new Set<string>();
    for (const note of notes) {
      requireNote(note, "set_notes");
      if (ids.has(note.id)) {
        throw new DocxEngineError("duplicate_note_id", "note id " + note.id + " appears twice");
      }
      ids.add(note.id);
    }
    const copy = notes.map(cloneNote);
    if (kind === "footnote") this.options.footnotes = copy;
    else this.options.endnotes = copy;
    this.touched = true;
    this.revision += 1;
  }

  /** Append one note (the caller allocates the id; the display number follows
   * list order). Blank bodies are refused: an inserted note is user text. */
  insertNote(kind: DocxNoteKind, note: DocxNoteInfo): void {
    this.requireNoteKind(kind, "insert_note");
    requireNote(note, "insert_note");
    if (note.text.trim().length === 0) {
      throw new DocxEngineError("empty_note_text", "insert_note note " + note.id + " needs non-blank text");
    }
    if (this.notes(kind).some((entry) => entry.id === note.id)) {
      throw new DocxEngineError("duplicate_note_id", "note id " + note.id + " already exists");
    }
    this.setNotes(kind, [...this.notes(kind), note]);
  }

  /** Edit a note's text. The plain-text edit drops the measured rich runs: the
   * vendored rebuild prefers richParas over text when it has to rebuild an
   * entry (notes.ts:265), so keeping stale runs would silently revert the
   * edit. The save still first tries an in-place w:t patch, which keeps the
   * entry's inline formatting (notes.ts:329). */
  setNoteText(kind: DocxNoteKind, id: string, text: string): void {
    this.requireNoteKind(kind, "set_note_text");
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new DocxEngineError("empty_note_text", "set_note_text needs non-blank text");
    }
    const list = this.notes(kind);
    const at = list.findIndex((note) => note.id === id);
    if (at < 0) throw new DocxEngineError("unknown_note", "no " + kind + " " + id + " to edit");
    const next: DocxNoteInfo = { ...list[at]!, text };
    delete next.richParas;
    list[at] = next;
    this.setNotes(kind, list);
  }

  /** Delete a note. The survivors keep their ids and order, so the saved part
   * numbers them 1..N again (renumbering is part order, Word's own rule). */
  deleteNote(kind: DocxNoteKind, id: string): void {
    this.requireNoteKind(kind, "delete_note");
    const list = this.notes(kind);
    if (!list.some((note) => note.id === id)) {
      throw new DocxEngineError("unknown_note", "no " + kind + " " + id + " to delete");
    }
    this.setNotes(kind, list.filter((note) => note.id !== id));
  }

  /** Typed dispatch so the adapter's edit channel stays a single entry. */
  applyEdit(edit: DocxEdit): void {
    if (isPageDecorEdit(edit)) return this.pageDecor.applyEdit(this.parsed, edit);
    if (isProtectionOp(edit)) return this.protection.applyEdit(edit);
    if (isDocxFieldEdit(edit)) return this.fieldEdits.applyEdit(this.parsed, edit);
    switch (edit.op) {
      case "set_paragraph_text":
        return this.setParagraphText(edit.docxIndex, edit.runs);
      case "insert_generated":
        return this.insertGenerated(edit.index, edit.block);
      case "replace_block_xml":
        return this.replaceBlockXml(edit.docxIndex, edit.xml, edit.replaceImage);
      case "insert_xml":
        return this.insertXml(edit.index, edit.xml);
      case "insert_image":
        return this.insertImage(edit.index, edit.image);
      case "insert_chart":
        return this.insertChart(edit.index, edit.chart, edit.extentPx);
      case "remove_block":
        return this.removeBlock(edit.docxIndex);
      case "set_header_footer":
        return this.setHeaderFooter(edit.slot, edit.hf);
      case "set_title_pg":
        return this.setTitlePg(edit.value);
      case "set_even_odd_headers":
        return this.setEvenOddHeaders(edit.value);
      case "set_comments":
        return this.setComments(edit.comments);
      case "set_notes":
        return this.setNotes(edit.kind, edit.notes);
      case "set_section_properties":
        return this.setSectionProperties(edit.sectionIndex, edit.properties);
      case "insert_numbering_def":
        return this.insertNumberingDef(edit.def);
      case "restart_numbering":
        return this.restartNumbering(edit.restart);
    }
  }

  /** Serialize the MODEL: the final plan + only the options the editor set.
   * An untouched plan is the all-original set — upstream answers the original
   * bytes (no-op save), which is the correct result, not a shortcut. */
  savePlan(): { finalBlocks: DocxSaveBlock[]; options: DocxSaveOptions } {
    const options: DocxSaveOptions = { ...this.options, ...this.pageDecor.saveOptions(), ...this.protection.saveOptions() };
    const numbering = this.numbering.options();
    if (numbering) options.numbering = numbering;
    const rewrites = this.sectionRewrites(options);
    const finalBlocks: DocxSaveBlock[] = this.plan.map((entry, at): DocxSaveBlock => {
      const rewrite = rewrites.get(at);
      switch (entry.source) {
        case "original": {
          if (rewrite) {
            const blockXml = originalXmlOf(this.parsed, entry.docxIndex);
            if (blockXml !== null && blockXml.includes(rewrite.from)) {
              return { kind: "xml", xml: blockXml.replace(rewrite.from, rewrite.to), docxIndex: entry.docxIndex };
            }
          }
          return { kind: "original", docxIndex: entry.docxIndex };
        }
        case "generated": {
          if (rewrite) {
            const rawPPr = (entry.block as { rawPPr?: unknown }).rawPPr;
            if (typeof rawPPr === "string" && rawPPr.includes(rewrite.from)) {
              return { kind: "generated", block: { ...entry.block, rawPPr: rawPPr.replace(rewrite.from, rewrite.to) } };
            }
          }
          return { kind: "generated", block: entry.block };
        }
        case "xml":
          return {
            kind: "xml",
            xml: rewrite && entry.xml.includes(rewrite.from) ? entry.xml.replace(rewrite.from, rewrite.to) : entry.xml,
            ...(entry.docxIndex !== undefined ? { docxIndex: entry.docxIndex } : {}),
            ...(entry.replaceImage ? { replaceImage: entry.replaceImage } : {}),
          };
        case "image":
          return { kind: "image", image: entry.image };
        case "chart":
          return { kind: "chart", chart: entry.chart, ...(entry.extentPx ? { extentPx: entry.extentPx } : {}) };
      }
    });
    return { finalBlocks, options };
  }

  /** Re-base after a successful serialize: the produced bytes become the new
   * original (their own parse), edits drain to the committed state — the docx
   * equivalent of pptx commitSaved (index.ts:718). */
  rebase(newParsed: DocxParsed): void {
    this.parsed = newParsed;
    this.plan = visibleIndexes(newParsed).map((docxIndex) => ({ source: "original", docxIndex }));
    this.options = {};
    this.sectionEdits.clear();
    this.pageDecor.clear();
    this.protection.clear();
    this.numbering = new DocxNumberingEdits(newParsed.numbering instanceof Map ? newParsed.numbering : undefined);
    this.touched = false;
  }
}
