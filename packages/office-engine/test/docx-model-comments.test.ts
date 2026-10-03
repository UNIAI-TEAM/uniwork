// DOCX comments tests — the model owns an authoritative comment list that
// reaches saveDocx as SaveOptions.comments (word/comments.xml regenerated from
// it, deleted ids' body markers stripped by upstream), while anchors ride on
// the run/block comment fields the generated-plan path re-emits.
// The recording wrapper keeps the shared fake engine untouched: it feeds the
// fixture's comments into the parse and captures the save arguments.
import { describe, expect, it } from "vitest";
import {
  createDocxAdapter,
  DocxSessionModel,
  type DocxCommentInfo,
  type DocxSaveBlock,
  type DocxSaveOptions,
} from "../src/docx";
import { createFakeDocxEngine, decodeFakeDocx, makeFakeDocxBytes, type FakeDocxFixture } from "./fake-docx-engine";

/** Typed-error oracle: callers branch on `code`, never on message text. */
const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const MAIN: DocxCommentInfo = { id: "1", author: "Alice", text: "first pass", date: "2026-07-01T10:00:00Z" };
const REPLY: DocxCommentInfo = { id: "2", author: "Bob", text: "agreed", parentId: "1" };

/** The fake fixture convention is JSON passthrough, so a comments field the
 * typed fixture does not declare still rides the package bytes. */
type CommentFixture = FakeDocxFixture & { comments?: DocxCommentInfo[] };

const commentedDocx = () => {
  const fixture: CommentFixture = {
    blocks: [
      { type: "paragraph", runs: [{ text: "before " }, { text: "marked", commentIds: ["1"] }, { text: " after" }] },
      { type: "paragraph", runs: [{ text: "plain" }] },
    ],
    comments: [MAIN, REPLY],
  };
  return makeFakeDocxBytes(fixture);
};

/** Fake engine + a capture of every saveDocx call's plan/options; the parse
 * carries the package's comments so the model sees a real comment list. */
function createCommentEngine() {
  const base = createFakeDocxEngine();
  const saves: Array<{ blocks: DocxSaveBlock[]; options: DocxSaveOptions | undefined }> = [];
  const engine = {
    async parseDocx(bytes: Uint8Array) {
      const parsed = await base.parseDocx(bytes);
      const pkg = decodeFakeDocx(bytes) as { comments?: DocxCommentInfo[] };
      if (pkg.comments) parsed.comments = pkg.comments;
      return parsed;
    },
    async saveDocx(parsed: Parameters<typeof base.saveDocx>[0], blocks: DocxSaveBlock[], options?: DocxSaveOptions) {
      saves.push({ blocks, options });
      return base.saveDocx(parsed, blocks, options);
    },
    listPackageParts: base.listPackageParts,
  };
  return { engine, saves };
}

const openCommented = async () => {
  const { engine, saves } = createCommentEngine();
  const adapter = createDocxAdapter({ engine });
  const out = await adapter.open({ bytes: commentedDocx(), format: "docx", document_id: "doc-c" });
  if (out.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(out));
  return { adapter, ref: out.document_model_ref, saves };
};

describe("docx comments model", () => {
  it("exposes the parsed comment list untouched", async () => {
    const { engine } = createCommentEngine();
    const parsed = await engine.parseDocx(commentedDocx());
    const model = new DocxSessionModel(parsed);
    expect(model.comments.map((c) => c.id)).toEqual(["1", "2"]);
    expect(model.comments[1]?.parentId).toBe("1");
    expect(model.isDirty).toBe(false);
  });

  it("an untouched list never reaches SaveOptions (comments part stays byte-identical)", async () => {
    const { adapter, ref, saves } = await openCommented();
    await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saves).toHaveLength(1);
    expect(saves[0]?.options?.comments).toBeUndefined();
  });

  it("set_comments rides into SaveOptions and the edited anchor into the plan", async () => {
    const { adapter, ref, saves } = await openCommented();
    const next = [MAIN, { ...REPLY, done: true }];
    adapter.edit(ref, { op: "set_comments", comments: next });
    // the in-paragraph range is expressible: the regenerated paragraph carries
    // its run-level commentIds, which upstream re-emits as start/end/reference
    adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 0, runs: [{ text: "marked edited", commentIds: ["1"] }] });
    await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saves[0]?.options?.comments?.map((c) => [c.id, c.done])).toEqual([
      ["1", undefined],
      ["2", true],
    ]);
    const generated = saves[0]?.blocks.find((b) => b.kind === "generated");
    expect(generated?.kind).toBe("generated");
    expect(generated && "block" in generated ? generated.block.runs[0]?.commentIds : undefined).toEqual(["1"]);
  });

  it("cross-paragraph anchors are expressible on generated blocks", async () => {
    const { adapter, ref, saves } = await openCommented();
    adapter.edit(ref, {
      op: "insert_generated",
      index: 0,
      block: { type: "paragraph", commentStarts: ["1"], runs: [{ text: "range opens" }] },
    });
    adapter.edit(ref, {
      op: "insert_generated",
      index: 1,
      block: { type: "paragraph", commentEnds: ["1"], runs: [{ text: "range closes" }] },
    });
    await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const blocks = saves[0]?.blocks.filter((b) => b.kind === "generated") ?? [];
    expect(blocks.map((b) => (b.kind === "generated" ? [b.block.commentStarts, b.block.commentEnds] : []))).toEqual([
      [["1"], undefined],
      [undefined, ["1"]],
    ]);
  });

  it("add / reply / resolve / delete mutate the authoritative list and the plan", async () => {
    const { engine } = createCommentEngine();
    const parsed = await engine.parseDocx(commentedDocx());
    const model = new DocxSessionModel(parsed);
    model.addComment({ id: "3", author: "Ana", text: "third" });
    expect(model.comments.map((c) => c.id)).toEqual(["1", "2", "3"]);
    model.replyToComment("3", { id: "4", author: "Ben", text: "reply" });
    expect(model.comments[3]).toMatchObject({ id: "4", parentId: "3" });
    model.setCommentResolved("3", true);
    // Word resolves a thread as a unit: the parent and its replies share done
    expect(model.comments.filter((c) => c.id === "3" || c.parentId === "3").map((c) => c.done)).toEqual([true, true]);
    expect(model.comments.find((c) => c.id === "1")?.done).toBeUndefined();
    model.deleteComment("3");
    expect(model.comments.map((c) => c.id)).toEqual(["1", "2"]);
    const { options } = model.savePlan();
    expect(options.comments?.map((c) => c.id)).toEqual(["1", "2"]);
    expect(model.isDirty).toBe(true);
    expect(model.revision).toBe(4);
  });

  it("set_comments accepts parsed author-less and empty-text entries (F2)", async () => {
    const { engine } = createCommentEngine();
    const parsed = await engine.parseDocx(commentedDocx());
    const model = new DocxSessionModel(parsed);
    // Real files carry these shapes (w:author is optional; empty bodies exist),
    // so a full-list set_comments must pass them through instead of refusing.
    const bare: DocxCommentInfo = { id: "7", author: "", text: "" };
    model.setComments([...model.comments, bare]);
    expect(model.comments.map((c) => c.id)).toEqual(["1", "2", "7"]);
    expect(model.savePlan().options.comments?.find((c) => c.id === "7")).toMatchObject({ author: "", text: "" });
    // the authoring path still refuses blank user text
    expect(errCode(() => model.addComment({ id: "8", author: "", text: "x" }))).toBe("bad_comment");
    expect(errCode(() => model.addComment({ id: "8", author: "A", text: "" }))).toBe("empty_comment_text");
    expect(errCode(() => model.addComment({ id: "8", author: "A", text: 7 as unknown as string }))).toBe("bad_comment");
  });

  it("delete removes a thread's replies with it", async () => {
    const { engine } = createCommentEngine();
    const parsed = await engine.parseDocx(commentedDocx());
    const model = new DocxSessionModel(parsed);
    model.deleteComment("1");
    expect(model.comments).toEqual([]);
    expect(model.savePlan().options.comments).toEqual([]);
  });

  it("resolve and delete cascade through replies to replies", async () => {
    const { engine } = createCommentEngine();
    const parsed = await engine.parseDocx(commentedDocx());
    const model = new DocxSessionModel(parsed);
    model.addComment({ id: "3", author: "Ana", text: "root" });
    model.replyToComment("3", { id: "4", author: "Ben", text: "reply" });
    model.replyToComment("4", { id: "5", author: "Cara", text: "deep" });
    model.setCommentResolved("3", true);
    expect(model.comments.filter((c) => ["3", "4", "5"].includes(c.id)).map((c) => c.done)).toEqual([true, true, true]);
    model.deleteComment("3");
    expect(model.comments.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("refuses malformed entries, duplicates, unknown parents and unknown ids", async () => {
    const { engine } = createCommentEngine();
    const parsed = await engine.parseDocx(commentedDocx());
    const model = new DocxSessionModel(parsed);
    expect(errCode(() => model.addComment({ id: "", author: "A", text: "x" }))).toBe("bad_comment");
    expect(errCode(() => model.addComment({ id: "9", author: "", text: "x" }))).toBe("bad_comment");
    expect(errCode(() => model.addComment({ id: "9", author: "A", text: "" }))).toBe("empty_comment_text");
    expect(errCode(() => model.addComment({ id: "1", author: "A", text: "dup" }))).toBe("duplicate_comment_id");
    expect(errCode(() => model.replyToComment("nope", { id: "9", author: "A", text: "x" }))).toBe("unknown_comment");
    expect(errCode(() => model.replyToComment("1", { id: "9", author: "A", text: "x", parentId: "2" }))).toBe("bad_comment");
    expect(errCode(() => model.setCommentResolved("nope", true))).toBe("unknown_comment");
    expect(errCode(() => model.deleteComment("nope"))).toBe("unknown_comment");
    expect(errCode(() => model.setComments("nope" as unknown as DocxCommentInfo[]))).toBe("bad_comment");
    expect(errCode(() => model.setComments([{ id: "", author: "A", text: "x" }]))).toBe("bad_comment");
    expect(errCode(() => model.setComments([MAIN, { ...MAIN }]))).toBe("duplicate_comment_id");
    expect(errCode(() => model.setComments([{ id: "5", author: "A", text: "orphan", parentId: "404" }]))).toBe("unknown_comment");
    // every refusal leaves the list untouched
    expect(model.comments.map((c) => c.id)).toEqual(["1", "2"]);
    expect(model.isDirty).toBe(false);
  });

  it("rebase drains comment edits into the new base (next save keeps the part)", async () => {
    const { engine } = createCommentEngine();
    const parsed = await engine.parseDocx(commentedDocx());
    const model = new DocxSessionModel(parsed);
    model.setCommentResolved("1", true);
    expect(model.savePlan().options.comments?.map((c) => c.done)).toEqual([true, true]);
    // the produced bytes become the new base with their own comment list
    model.rebase({ ...parsed, comments: [{ ...MAIN, done: true }, { ...REPLY, done: true }] });
    expect(model.isDirty).toBe(false);
    expect(model.comments.every((c) => c.done === true)).toBe(true);
    expect(model.savePlan().options.comments).toBeUndefined();
  });
});
