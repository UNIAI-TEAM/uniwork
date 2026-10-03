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
  DocxEngineError,
  type DocxBlock,
  type DocxCommentInfo,
  type DocxGeneratedBlock,
  type DocxHeaderFooter,
  type DocxNewChart,
  type DocxNewImage,
  type DocxParsed,
  type DocxRun,
  type DocxSaveBlock,
  type DocxSaveOptions,
} from "./engine";

/** One plan row: an original block ref, or the replacement the model carries. */
type PlanEntry =
  | { source: "original"; docxIndex: number }
  | { source: "generated"; block: DocxGeneratedBlock }
  | { source: "xml"; xml: string; docxIndex?: number; replaceImage?: { base64: string; mime: DocxNewImage["mime"] } }
  | { source: "image"; image: DocxNewImage }
  | { source: "chart"; chart: DocxNewChart; extentPx?: { w: number; h: number } };

/** Formats the vendored writer can embed (patch.ts embedImage). */
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif"]);

/** Shared bytes oracle for image payloads: a mime the writer cannot embed would
 * otherwise produce a dangling relationship (or a silently dropped picture). */
function requireImageBytes(image: { base64: string; mime: string } | undefined, what: string): void {
  if (!image || typeof image.base64 !== "string" || image.base64.length === 0) {
    throw new DocxEngineError("bad_image", what + " needs image bytes");
  }
  if (!IMAGE_MIMES.has(image.mime)) {
    throw new DocxEngineError("bad_image_mime", what + " mime " + String(image.mime) + " is not png/jpeg/gif");
  }
}

/** Comment payload oracle: the save regenerates word/comments.xml from
 * id/author/text alone, so a malformed entry is refused before it can reach
 * the part (an id-less or blank comment would corrupt the rebuild). */
function requireComment(comment: DocxCommentInfo, what: string): void {
  if (!comment || typeof comment !== "object") {
    throw new DocxEngineError("bad_comment", what + " needs a comment object");
  }
  if (typeof comment.id !== "string" || comment.id.length === 0) {
    throw new DocxEngineError("bad_comment", what + " comment needs a non-empty id");
  }
  if (typeof comment.author !== "string" || comment.author.length === 0) {
    throw new DocxEngineError("bad_comment", what + " comment " + comment.id + " needs an author");
  }
  if (typeof comment.text !== "string" || comment.text.length === 0) {
    throw new DocxEngineError("empty_comment_text", what + " comment " + comment.id + " needs non-empty text");
  }
}

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
  | { op: "set_comments"; comments: DocxCommentInfo[] };

export type DocxHfSlot = "header" | "footer" | "headerFirst" | "footerFirst" | "headerEven" | "footerEven";

/** Every legal original top-level block in document order — the only set a
 * save plan may draw originals from. Hidden blocks are not listed; saveDocx
 * appends them automatically. */
export function visibleIndexes(parsed: DocxParsed): number[] {
  return parsed.blocks
    .filter((b) => !b.hidden && b.docxIndex !== null)
    .map((b) => b.docxIndex as number);
}

/** Visible paragraphs — the text-editable subset. Headings/lists/tables/
 * images/passthrough stay inventoried but are never silently retyped. */
export function editableIndexes(parsed: DocxParsed): number[] {
  return parsed.blocks
    .filter((b) => !b.hidden && b.docxIndex !== null && b.type === "paragraph")
    .map((b) => b.docxIndex as number);
}

export function plainText(parsed: DocxParsed): string {
  return parsed.blocks
    .map((b) => (b.runs ?? []).map((r) => r.text ?? "").join(""))
    .join("\n");
}

export class DocxSessionModel {
  /** The engine's parse handle — passed back to saveDocx untouched. */
  parsed: DocxParsed;
  private plan: PlanEntry[];
  private options: DocxSaveOptions = {};
  private touched = false;
  /** Monotonic edit counter — a two-save chain can prove the base advanced. */
  revision = 0;

  constructor(parsed: DocxParsed) {
    this.parsed = parsed;
    this.plan = visibleIndexes(parsed).map((docxIndex) => ({ source: "original", docxIndex }));
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
   * parent; the caller's array is copied, never aliased into the plan. */
  setComments(comments: DocxCommentInfo[]): void {
    if (!Array.isArray(comments)) {
      throw new DocxEngineError("bad_comment", "set_comments needs a comment list");
    }
    const ids = new Set<string>();
    for (const comment of comments) {
      requireComment(comment, "set_comments");
      if (ids.has(comment.id)) {
        throw new DocxEngineError("duplicate_comment_id", "comment id " + comment.id + " appears twice");
      }
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

  /** Append one comment (the caller allocates the id; the save assigns the
   * commentsExtended paraId for new entries). */
  addComment(comment: DocxCommentInfo): void {
    requireComment(comment, "add_comment");
    if (this.comments.some((c) => c.id === comment.id)) {
      throw new DocxEngineError("duplicate_comment_id", "comment id " + comment.id + " already exists");
    }
    this.setComments([...this.comments, { ...comment }]);
  }

  /** Append a reply anchored to `parentId` (Word: a reply shares the parent
   * comment's document range, so the anchor is the parent's). */
  replyToComment(parentId: string, reply: DocxCommentInfo): void {
    requireComment(reply, "reply_to_comment");
    const list = this.comments;
    if (!list.some((c) => c.id === parentId)) {
      throw new DocxEngineError("unknown_comment", "no comment " + parentId + " to reply to");
    }
    if (reply.parentId !== undefined && reply.parentId !== parentId) {
      throw new DocxEngineError("bad_comment", "reply " + reply.id + " carries parentId " + reply.parentId + ", not " + parentId);
    }
    if (list.some((c) => c.id === reply.id)) {
      throw new DocxEngineError("duplicate_comment_id", "comment id " + reply.id + " already exists");
    }
    this.setComments([...list, { ...reply, parentId }]);
  }

  /** Resolve/reopen a thread: the comment and its replies share the flag
   * (Word resolves a thread as a unit). */
  setCommentResolved(id: string, done: boolean): void {
    const list = this.comments;
    if (!list.some((c) => c.id === id)) {
      throw new DocxEngineError("unknown_comment", "no comment " + id + " to resolve");
    }
    this.setComments(list.map((c) => (c.id === id || c.parentId === id ? { ...c, done } : c)));
  }

  /** Delete a comment; its replies go with it (Word deletes the thread). The
   * body markers disappear because the save strips markers for ids no longer
   * in the list (upstream removeDeletedCommentMarkers). */
  deleteComment(id: string): void {
    const list = this.comments;
    if (!list.some((c) => c.id === id)) {
      throw new DocxEngineError("unknown_comment", "no comment " + id + " to delete");
    }
    const gone = new Set([id, ...list.filter((c) => c.parentId === id).map((c) => c.id)]);
    this.setComments(list.filter((c) => !gone.has(c.id)));
  }

  /** Typed dispatch so the adapter's edit channel stays a single entry. */
  applyEdit(edit: DocxEdit): void {
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
    }
  }

  /** Serialize the MODEL: the final plan + only the options the editor set.
   * An untouched plan is the all-original set — upstream answers the original
   * bytes (no-op save), which is the correct result, not a shortcut. */
  savePlan(): { finalBlocks: DocxSaveBlock[]; options: DocxSaveOptions } {
    const finalBlocks: DocxSaveBlock[] = this.plan.map((e): DocxSaveBlock => {
      switch (e.source) {
        case "original":
          return { kind: "original", docxIndex: e.docxIndex };
        case "generated":
          return { kind: "generated", block: e.block };
        case "xml":
          return {
            kind: "xml",
            xml: e.xml,
            ...(e.docxIndex !== undefined ? { docxIndex: e.docxIndex } : {}),
            ...(e.replaceImage ? { replaceImage: e.replaceImage } : {}),
          };
        case "image":
          return { kind: "image", image: e.image };
        case "chart":
          return { kind: "chart", chart: e.chart, ...(e.extentPx ? { extentPx: e.extentPx } : {}) };
      }
    });
    return { finalBlocks, options: { ...this.options } };
  }

  /** Re-base after a successful serialize: the produced bytes become the new
   * original (their own parse), edits drain to the committed state — the docx
   * equivalent of pptx commitSaved (index.ts:718). */
  rebase(newParsed: DocxParsed): void {
    this.parsed = newParsed;
    this.plan = visibleIndexes(newParsed).map((docxIndex) => ({ source: "original", docxIndex }));
    this.options = {};
    this.touched = false;
  }
}
