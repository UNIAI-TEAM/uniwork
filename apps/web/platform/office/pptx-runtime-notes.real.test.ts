/** @vitest-environment node */
// UNI-927 X6 (X1-review F1) - set_notes on a notes part WITHOUT a body
// placeholder, on the real vendored engine and the real fixture
// pptx-notes.pptx. The vendored setSlideNotes appends a body shape and leaves
// the old free-standing text shape, so the saved page showed both texts; the
// engine's set_notes gesture now drops that stale shape, so the notes replace
// the old text exactly once, and undo restores the original part.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPptx } from "@uniwork/office-upstream/pptx-renderer";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { createWebPptxSessionRuntime } from "./pptx-runtime";

// vitest runs with cwd = apps/web.
const notesFixture = () => new Uint8Array(readFileSync(resolve(process.cwd(), "../../docs/office/g0/fixtures/files/slides/pptx-notes.pptx")));
const OLD_TEXT = "Ghi chú trình bày cho buổi họp tuần.";
const NEW_TEXT = "Ghi chú mới\ndòng hai";
const NOTES_PART = "ppt/notesSlides/notesSlide1.xml";

type Runtime = ReturnType<typeof createWebPptxSessionRuntime>;

const open = async (runtime: Runtime, bytes: Uint8Array, id: string): Promise<string> => {
  const result = await runtime.open({ bytes, documentId: id });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
  return result.document_model_ref;
};

const save = async (runtime: Runtime, ref: string): Promise<Uint8Array> => {
  const value = runtime.snapshot(ref);
  return (await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value } })).bytes;
};

/** The notes part of a saved package, read with the real engine. */
const notesPartOf = async (bytes: Uint8Array): Promise<string> => {
  const opened = (await openPptx(bytes)) as { archive: { readText(path: string): string | null } };
  const xml = opened.archive.readText(NOTES_PART);
  if (!xml) throw new Error(NOTES_PART + " is missing");
  return xml;
};

const textsOf = (xml: string): string[] => [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]!);

describe("web PPTX runtime on the real engine - notes without a body placeholder (X6)", () => {
  it("replaces the old notes text exactly once, and undo restores the original part", async () => {
    const original = notesFixture();
    const originalPart = await notesPartOf(original);
    // The fixture shape the finding is about: text, but no body placeholder.
    expect(textsOf(originalPart)).toEqual([OLD_TEXT]);
    expect(originalPart).not.toMatch(/<p:ph\b[^>]*type="body"/);

    const runtime = createWebPptxSessionRuntime({ documentId: "notes-x6" });
    const ref = await open(runtime, original, "notes-x6");
    await runtime.edit(ref, [{ op: "set_notes", slideIndex: 0, text: NEW_TEXT } as PptxEdit]);
    expect(runtime.slideNotes!(ref, 0)).toBe(NEW_TEXT);

    // Saved + reopened: the new text reads back, and the part holds no stale copy.
    const saved = await save(runtime, ref);
    const savedPart = await notesPartOf(saved);
    expect(textsOf(savedPart)).toEqual(["Ghi chú mới", "dòng hai"]);
    expect(savedPart).not.toContain(OLD_TEXT);
    expect(savedPart.match(/<p:ph\b[^>]*type="body"/g)).toHaveLength(1);
    const reopenedRuntime = createWebPptxSessionRuntime({ documentId: "notes-x6-2" });
    const reopened = await open(reopenedRuntime, saved, "notes-x6-2");
    expect(reopenedRuntime.slideNotes!(reopened, 0)).toBe(NEW_TEXT);

    // Undo = reopen the base: the old text and the original part come back; redo repeats the edit.
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.slideNotes!(ref, 0)).toBe(OLD_TEXT);
    expect(await notesPartOf(await save(runtime, ref))).toBe(originalPart);
    expect(await runtime.redo(ref)).toBe(true);
    expect(await notesPartOf(await save(runtime, ref))).toBe(savedPart);

    // Editing again, and clearing, keep one body shape and never revive the old text.
    await runtime.edit(ref, [{ op: "set_notes", slideIndex: 0, text: "" } as PptxEdit]);
    expect(runtime.slideNotes!(ref, 0)).toBe("");
    const cleared = await notesPartOf(await save(runtime, ref));
    expect(cleared).not.toContain(OLD_TEXT);
    expect(textsOf(cleared)).toEqual([]);
    await runtime.release(ref);
    await reopenedRuntime.release(reopened);
  }, 60_000);
});
