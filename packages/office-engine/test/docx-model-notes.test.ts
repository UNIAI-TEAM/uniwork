// DOCX notes tests — the model owns authoritative footnote/endnote lists that
// reach saveDocx as SaveOptions.footnotes/endnotes (word/footnotes.xml and
// word/endnotes.xml regenerated from them in list order: note numbers follow
// order, so a delete renumbers the survivors), while body references ride on
// the run-level noteRef field the generated-plan path re-emits as
// w:footnoteReference/w:endnoteReference.
// The recording wrapper keeps the shared fake engine untouched: it feeds the
// fixture's notes into the parse and captures the save arguments.
import { describe, expect, it } from "vitest";
import {
  createDocxAdapter,
  DocxSessionModel,
  type DocxNoteInfo,
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

const FN1: DocxNoteInfo = { id: "1", text: "first note" };
const FN2: DocxNoteInfo = { id: "2", text: "second note", richParas: [[{ text: "second note", bold: true }]] };
const EN1: DocxNoteInfo = { id: "1", text: "closing thought" };

/** The fake fixture convention is JSON passthrough, so note fields the typed
 * fixture does not declare still ride the package bytes. */
type NoteFixture = FakeDocxFixture & { footnotes?: DocxNoteInfo[]; endnotes?: DocxNoteInfo[] };

const notedDocx = () => {
  const fixture: NoteFixture = {
    blocks: [
      { type: "paragraph", runs: [{ text: "body " }, { text: "1", noteRef: { kind: "footnote", id: "1" } }, { text: " more" }] },
      { type: "paragraph", runs: [{ text: "plain" }] },
    ],
    footnotes: [FN1, FN2],
    endnotes: [EN1],
  };
  return makeFakeDocxBytes(fixture);
};

/** Fake engine + a capture of every saveDocx call's plan/options; the parse
 * carries the package's note lists so the model sees real notes. */
function createNoteEngine() {
  const base = createFakeDocxEngine();
  const saves: Array<{ blocks: DocxSaveBlock[]; options: DocxSaveOptions | undefined }> = [];
  const engine = {
    async parseDocx(bytes: Uint8Array) {
      const parsed = await base.parseDocx(bytes);
      const pkg = decodeFakeDocx(bytes) as { footnotes?: DocxNoteInfo[]; endnotes?: DocxNoteInfo[] };
      if (pkg.footnotes) parsed.footnotes = pkg.footnotes;
      if (pkg.endnotes) parsed.endnotes = pkg.endnotes;
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

const openNoted = async () => {
  const { engine, saves } = createNoteEngine();
  const adapter = createDocxAdapter({ engine });
  const out = await adapter.open({ bytes: notedDocx(), format: "docx", document_id: "doc-n" });
  if (out.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(out));
  return { adapter, ref: out.document_model_ref, saves };
};

describe("docx notes model", () => {
  it("exposes the parsed note lists untouched, both kinds kept apart", async () => {
    const { engine } = createNoteEngine();
    const parsed = await engine.parseDocx(notedDocx());
    const model = new DocxSessionModel(parsed);
    expect(model.notes("footnote").map((n) => n.id)).toEqual(["1", "2"]);
    expect(model.notes("endnote").map((n) => n.id)).toEqual(["1"]);
    expect(model.notes("footnote")[1]?.richParas?.[0]?.[0]).toMatchObject({ text: "second note", bold: true });
    expect(model.isDirty).toBe(false);
  });

  it("untouched lists never reach SaveOptions (notes part stays byte-identical)", async () => {
    const { adapter, ref, saves } = await openNoted();
    await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saves).toHaveLength(1);
    expect(saves[0]?.options?.footnotes).toBeUndefined();
    expect(saves[0]?.options?.endnotes).toBeUndefined();
  });

  it("set_notes rides into SaveOptions and the reference marker into the plan", async () => {
    const { adapter, ref, saves } = await openNoted();
    const next = [FN1, FN2, { id: "3", text: "added note" }];
    adapter.edit(ref, { op: "set_notes", kind: "footnote", notes: next });
    // the marker is expressible: a regenerated paragraph carries its run-level
    // noteRef, which upstream re-emits as w:footnoteReference
    adapter.edit(ref, {
      op: "set_paragraph_text",
      docxIndex: 0,
      runs: [{ text: "body " }, { text: "3", noteRef: { kind: "footnote", id: "3" } }, { text: " more" }],
    });
    await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saves[0]?.options?.footnotes?.map((n) => n.id)).toEqual(["1", "2", "3"]);
    expect(saves[0]?.options?.endnotes).toBeUndefined();
    const generated = saves[0]?.blocks.find((b) => b.kind === "generated");
    expect(generated && "block" in generated ? generated.block.runs[1]?.noteRef : undefined).toEqual({ kind: "footnote", id: "3" });
  });

  it("insert / edit / delete mutate the authoritative list; a delete renumbers by order", async () => {
    const { engine } = createNoteEngine();
    const parsed = await engine.parseDocx(notedDocx());
    const model = new DocxSessionModel(parsed);
    model.insertNote("footnote", { id: "3", text: "third" });
    expect(model.notes("footnote").map((n) => n.id)).toEqual(["1", "2", "3"]);
    model.setNoteText("footnote", "3", "third edited");
    expect(model.notes("footnote")[2]?.text).toBe("third edited");
    model.deleteNote("footnote", "1");
    // note "2" is now first in part order: the saved part numbers it 1
    expect(model.savePlan().options.footnotes?.map((n) => n.id)).toEqual(["2", "3"]);
    expect(model.notes("footnote").map((n) => n.text)).toEqual(["second note", "third edited"]);
    expect(model.isDirty).toBe(true);
    expect(model.revision).toBe(3);
  });

  it("a text edit drops stale rich runs so the rebuild cannot revert it", async () => {
    const { engine } = createNoteEngine();
    const parsed = await engine.parseDocx(notedDocx());
    const model = new DocxSessionModel(parsed);
    model.setNoteText("footnote", "2", "rewritten");
    const edited = model.savePlan().options.footnotes?.find((n) => n.id === "2");
    expect(edited?.text).toBe("rewritten");
    expect(edited?.richParas).toBeUndefined();
  });

  it("refuses malformed entries, duplicates, blank authored text and unknown ids", async () => {
    const { engine } = createNoteEngine();
    const parsed = await engine.parseDocx(notedDocx());
    const model = new DocxSessionModel(parsed);
    expect(errCode(() => model.setNotes("sidebar" as never, []))).toBe("bad_note_kind");
    expect(errCode(() => model.notes("sidebar" as never))).toBe("bad_note_kind");
    expect(errCode(() => model.setNotes("footnote", "nope" as unknown as DocxNoteInfo[]))).toBe("bad_note");
    expect(errCode(() => model.setNotes("footnote", [{ id: "", text: "x" }]))).toBe("bad_note");
    expect(errCode(() => model.setNotes("footnote", [{ id: "9", text: 3 as unknown as string }]))).toBe("bad_note");
    expect(errCode(() => model.setNotes("footnote", [FN1, { ...FN1 }]))).toBe("duplicate_note_id");
    expect(errCode(() => model.insertNote("footnote", { id: "9", text: "  " }))).toBe("empty_note_text");
    expect(errCode(() => model.insertNote("footnote", { id: "1", text: "dup" }))).toBe("duplicate_note_id");
    expect(errCode(() => model.setNoteText("footnote", "9", "x"))).toBe("unknown_note");
    expect(errCode(() => model.setNoteText("footnote", "1", " "))).toBe("empty_note_text");
    expect(errCode(() => model.deleteNote("footnote", "9"))).toBe("unknown_note");
    // an empty body is legal in a full-list replacement (a real Word state)
    model.setNotes("endnote", [{ id: "1", text: "" }]);
    expect(model.notes("endnote")).toEqual([{ id: "1", text: "" }]);
  });

  it("editing one kind leaves the other kind's part byte-identical", async () => {
    const { engine } = createNoteEngine();
    const parsed = await engine.parseDocx(notedDocx());
    const model = new DocxSessionModel(parsed);
    model.deleteNote("footnote", "1");
    const { options } = model.savePlan();
    expect(options.footnotes?.map((n) => n.id)).toEqual(["2"]);
    expect(options.endnotes).toBeUndefined();
  });

  it("rebase drains note edits into the new base (next save keeps the parts)", async () => {
    const { engine } = createNoteEngine();
    const parsed = await engine.parseDocx(notedDocx());
    const model = new DocxSessionModel(parsed);
    model.deleteNote("footnote", "1");
    expect(model.savePlan().options.footnotes?.map((n) => n.id)).toEqual(["2"]);
    // the produced bytes become the new base with their own regenerated list
    model.rebase({ ...parsed, footnotes: [FN2] });
    expect(model.isDirty).toBe(false);
    expect(model.notes("footnote").map((n) => n.id)).toEqual(["2"]);
    expect(model.savePlan().options.footnotes).toBeUndefined();
  });
});
