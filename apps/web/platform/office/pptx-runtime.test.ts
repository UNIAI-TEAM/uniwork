/** @vitest-environment node */
// UNI-927 (P0-1, F2) - drives the REAL createWebPptxSessionRuntime against the
// REAL PptxAdapter/PptxSessionModel. Only the generated-artifact seam
// (@uniwork/office-upstream/pptx-renderer) is mocked, so the serialize lane,
// journal base64 encode/decode, both prefix guards and the restore replay all
// execute for real - the coverage the P0-1 review found missing (F1 shipped
// because nothing exercised this file).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PptxEngineError } from "@uniwork/office-engine/pptx";
import type { OpenedPptxLike, PptxEdit, PptxTxnRequest } from "@uniwork/office-engine/pptx";
import { makeFakePptxBytes } from "../../../../packages/office-engine/test/fake-pptx-fixtures";
import {
  createWebPptxSessionRuntime,
  decodePptxEdit,
  encodePptxEdit,
  fingerprintPptxSnapshot,
  sha256Hex,
  stableJson,
  type PptxDeckSnapshot,
  type PptxSessionRuntime,
} from "./pptx-runtime";

// Instrumented artifact seam: `events` records the order the engine functions
// run so the single-lane test can prove an edit never lands inside a save.
const seam = vi.hoisted(() => ({
  events: [] as string[],
  gate: null as null | { promise: Promise<void>; resolve: () => void },
}));

vi.mock("@uniwork/office-upstream/pptx-renderer", async () => {
  const fakes = await import("../../../../packages/office-engine/test/fake-pptx-engine");
  const engine = fakes.createFakePptxEngine();
  const ops = fakes.createFakePptxOps();
  return {
    openPptx: async (bytes: Uint8Array) => {
      seam.events.push("open");
      const opened = await engine.openPptx(bytes);
      // The fake engine keeps notes on the opened handle (setNotes writes
      // __notes[index]); the vendored read is archive-keyed, so link the two
      // the way the real PackageArchive + notes.ts pair does.
      (opened.archive as unknown as Record<string, unknown>).__opened = opened;
      return opened;
    },
    savePptx: async (opened: OpenedPptxLike) => {
      seam.events.push("save:start");
      if (seam.gate) await seam.gate.promise;
      seam.events.push("save:end");
      return engine.savePptx(opened);
    },
    getSlideNotes: (archive: unknown, slidePath: string) => {
      const opened = (archive as { __opened?: { __notes?: Record<string, string> } }).__opened;
      const index = /slide(\d+)\.xml$/.exec(slidePath)?.[1];
      if (!opened || index === undefined) return "";
      return opened.__notes?.[String(Number(index) - 1)] ?? "";
    },
    commitSaved: (opened: OpenedPptxLike) => engine.commitSaved?.(opened),
    reparseDeck: (opened: OpenedPptxLike) => engine.reparseDeck?.(opened) ?? opened,
    listSlideLayouts: (archive: unknown) => engine.listSlideLayouts?.(archive) ?? [],
    runTxn: (opened: OpenedPptxLike, request: PptxTxnRequest) => {
      if (request.dryRun !== true) seam.events.push("edit");
      return ops.runTxn(opened, request);
    },
    buildRenderSlide: () => ({ nodes: [] }),
    HeuristicMetrics: class HeuristicMetrics {},
  };
});

const bytes = () => makeFakePptxBytes();
const hidden = (slideIndex: number, value: boolean): PptxEdit => ({ op: "set_slide_hidden", slideIndex, hidden: value });
const image = (): PptxEdit => ({ op: "add_image", slideIndex: 0, bytes: new Uint8Array([1, 2, 3]), ext: "png", xPx: 0, yPx: 0, wPx: 10, hPx: 10 });
/** A deck snapshot whose revision defaults to its journal length; pass a
 * different revision to build the internally inconsistent case (F6). */
const deck = (edits: PptxEdit[], revision = edits.length): PptxDeckSnapshot => ({ revision, edits: edits.map(encodePptxEdit) });
const snapshot = (value: PptxDeckSnapshot, generation = value.revision) => ({ generation, fingerprint: "fp", value });

async function opened(): Promise<{ runtime: PptxSessionRuntime; ref: string }> {
  const runtime = createWebPptxSessionRuntime({ documentId: "doc" });
  const result = await runtime.open({ bytes: bytes(), documentId: "doc" });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("open failed");
  return { runtime, ref: result.document_model_ref };
}

beforeEach(() => {
  seam.events = [];
  seam.gate = null;
});

describe("web PPTX session runtime", () => {
  it("opens, edits and serializes in order, never interleaving a save with an edit", async () => {
    const { runtime, ref } = await opened();
    expect(seam.events).toEqual(["open"]);
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });

    // Straight path: open -> edit -> serialize on the one lane.
    expect(await runtime.edit(ref, [hidden(0, true)])).toEqual({ revision: 1 });
    expect(runtime.snapshot(ref)).toEqual({ revision: 1, edits: [hidden(0, true)] });
    expect(runtime.slides(ref)[0]?.hidden).toBe(true);

    // Hold a save open and queue an edit behind it: the edit must not run
    // until the save's engine call has finished.
    seam.events = [];
    let release!: () => void;
    seam.gate = { promise: new Promise<void>((resolve) => { release = resolve; }), resolve: () => release() };
    const saving = runtime.serialize(ref, { snapshot: snapshot(runtime.snapshot(ref)) });
    const editing = runtime.edit(ref, [hidden(1, true)]);
    await vi.waitFor(() => expect(seam.events).toContain("save:start"));
    expect(seam.events).not.toContain("edit");
    seam.gate.resolve();
    const [out] = await Promise.all([saving, editing]);
    seam.gate = null;
    expect(out.bytes.length).toBeGreaterThan(0);
    expect(out.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(seam.events.indexOf("save:end")).toBeLessThan(seam.events.indexOf("edit"));
    expect(runtime.snapshot(ref).revision).toBe(2);
  });

  it("refuses a snapshot that is not the live journal's prefix", async () => {
    const { runtime, ref } = await opened();
    await runtime.edit(ref, [hidden(0, true)]);

    // A different first edit than the live journal.
    await expect(runtime.serialize(ref, { snapshot: snapshot(deck([hidden(1, true)])) }))
      .rejects.toThrow("pptx_save_snapshot_invalid");
    // A snapshot carrying an edit the model never applied.
    await expect(runtime.serialize(ref, { snapshot: snapshot(deck([hidden(0, true), hidden(1, true)])) }))
      .rejects.toThrow("pptx_save_snapshot_invalid");
    // F6: a revision that disagrees with the journal length is inconsistent.
    await expect(runtime.serialize(ref, { snapshot: snapshot(deck([hidden(0, true)], 3)) }))
      .rejects.toThrow("pptx_save_snapshot_invalid");

    // The genuine prefix still saves.
    const out = await runtime.serialize(ref, { snapshot: snapshot(runtime.snapshot(ref)) });
    expect(out.bytes.length).toBeGreaterThan(0);
  });

  it("replays a recovered draft onto a fresh session (the F1 case)", async () => {
    const first = await opened();
    await first.runtime.edit(first.ref, [hidden(0, true)]);
    await first.runtime.edit(first.ref, [hidden(1, true)]);
    const draft = first.runtime.snapshot(first.ref);
    expect(draft).toEqual({ revision: 2, edits: [hidden(0, true), hidden(1, true)] });

    // A fresh open has an empty journal. Before the F1 fix this restore threw
    // pptx_restore_diverged for every draft with at least one edit.
    const second = await opened();
    expect(second.runtime.snapshot(second.ref).edits).toEqual([]);
    await second.runtime.restore!(second.ref, draft);
    expect(second.runtime.snapshot(second.ref)).toEqual(draft);
    expect(second.runtime.slides(second.ref)[0]?.hidden).toBe(true);
    expect(second.runtime.slides(second.ref)[1]?.hidden).toBe(true);

    // Replaying onto a session that already holds the prefix applies the tail only.
    const partial = await opened();
    await partial.runtime.edit(partial.ref, [hidden(0, true)]);
    await partial.runtime.restore!(partial.ref, draft);
    expect(partial.runtime.snapshot(partial.ref)).toEqual(draft);

    // A journal that diverges from the snapshot is refused.
    const diverged = await opened();
    await diverged.runtime.edit(diverged.ref, [hidden(1, true)]);
    await expect(diverged.runtime.restore!(diverged.ref, draft)).rejects.toThrow("pptx_restore_diverged");

    // The restored session serializes the deck the draft came from.
    const out = await second.runtime.serialize(second.ref, { snapshot: snapshot(second.runtime.snapshot(second.ref)) });
    expect(out.bytes.length).toBeGreaterThan(0);
  });

  it("round-trips Uint8Array edit payloads through base64 in the journal", async () => {
    const encoded = encodePptxEdit(image());
    expect(encoded.bytes).toEqual({ __bytes: "AQID" });
    expect(JSON.parse(JSON.stringify(encoded)).bytes).toEqual({ __bytes: "AQID" });
    const decoded = decodePptxEdit(encoded) as { bytes: Uint8Array };
    expect(decoded.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded.bytes)).toEqual([1, 2, 3]);

    // Through the runtime: the snapshot is JSON-safe, and restoring it decodes
    // the bytes back into a real engine edit that creates the picture.
    const first = await opened();
    await first.runtime.edit(first.ref, [image()]);
    const draft = first.runtime.snapshot(first.ref);
    expect(draft.edits[0]?.bytes).toEqual({ __bytes: "AQID" });
    expect(JSON.stringify(draft)).not.toContain("Uint8Array");

    const second = await opened();
    await second.runtime.restore!(second.ref, JSON.parse(JSON.stringify(draft)) as PptxDeckSnapshot);
    expect(second.runtime.slides(second.ref)[0]?.elements.some((element) => element.type === "picture")).toBe(true);
  });

  it("hashes and fingerprints deterministically", async () => {
    // FIPS 180-4 vectors.
    expect(await sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const once = await sha256Hex(new Uint8Array([80, 75, 3, 4]));
    expect(once).toBe(await sha256Hex(new Uint8Array([80, 75, 3, 4])));
    expect(once).toMatch(/^[0-9a-f]{64}$/);

    // stableJson is key-order independent, so equal decks fingerprint equally.
    expect(stableJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    const left = deck([hidden(0, true)]);
    const reordered = deck([{ hidden: true, slideIndex: 0, op: "set_slide_hidden" }]);
    expect(await fingerprintPptxSnapshot(left)).toBe(await fingerprintPptxSnapshot(reordered));
    expect(await fingerprintPptxSnapshot(left)).not.toBe(await fingerprintPptxSnapshot(deck([hidden(0, true), hidden(1, true)])));
  });

  it("honors an aborted serialize signal instead of minting save bytes", async () => {
    const { runtime, ref } = await opened();
    const controller = new AbortController();
    controller.abort();
    await expect(runtime.serialize(ref, { snapshot: snapshot(runtime.snapshot(ref)), signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(seam.events).toEqual(["open"]);
  });

  it("undoes and redoes by replaying the journal onto the reopened base", async () => {
    const { runtime, ref } = await opened();
    await runtime.edit(ref, [hidden(0, true)]);
    const afterFirst = runtime.snapshot(ref);
    await runtime.edit(ref, [hidden(1, true)]);
    expect(runtime.snapshot(ref)).toEqual({ revision: 2, edits: [hidden(0, true), hidden(1, true)] });

    // Undo drops the second edit: the snapshot is exactly the after-first-edit
    // journal and the live model matches it.
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual(afterFirst);
    expect(runtime.snapshot(ref)).toEqual({ revision: 1, edits: [hidden(0, true)] });
    expect(runtime.slides(ref)[0]?.hidden).toBe(true);
    expect(runtime.slides(ref)[1]?.hidden).toBe(false);

    // Undo back to the base is a real model change; a further undo is a no-op.
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });
    expect(runtime.slides(ref)[0]?.hidden).toBe(false);
    expect(await runtime.undo(ref)).toBe(false);

    // Redo restores the undone edits in order; redo at the tip is a no-op.
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual({ revision: 1, edits: [hidden(0, true)] });
    expect(runtime.slides(ref)[0]?.hidden).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual({ revision: 2, edits: [hidden(0, true), hidden(1, true)] });
    expect(runtime.slides(ref)[1]?.hidden).toBe(true);
    expect(await runtime.redo(ref)).toBe(false);
  });

  it("saves the post-undo prefix and refuses a snapshot carrying the undone edit", async () => {
    const { runtime, ref } = await opened();
    await runtime.edit(ref, [hidden(0, true)]);
    await runtime.edit(ref, [hidden(1, true)]);
    const full = runtime.snapshot(ref);
    expect(await runtime.undo(ref)).toBe(true);

    // The live model holds journal[0..cursor-1]; its own snapshot is a valid save.
    const out = await runtime.serialize(ref, { snapshot: snapshot(runtime.snapshot(ref)) });
    expect(out.bytes.length).toBeGreaterThan(0);
    // A snapshot that still carries the undone edit is not the live prefix.
    await expect(runtime.serialize(ref, { snapshot: snapshot(full) })).rejects.toThrow("pptx_save_snapshot_invalid");
  });

  it("drops the redo tail when a new edit lands after an undo", async () => {
    const { runtime, ref } = await opened();
    await runtime.edit(ref, [hidden(0, true)]);
    await runtime.edit(ref, [hidden(1, true)]);
    expect(await runtime.undo(ref)).toBe(true);
    await runtime.edit(ref, [{ op: "add_blank_slide", slideIndex: 1 }]);
    expect(runtime.snapshot(ref)).toEqual({ revision: 2, edits: [hidden(0, true), { op: "add_blank_slide", slideIndex: 1 }] });
    expect(await runtime.redo(ref)).toBe(false);
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual({ revision: 1, edits: [hidden(0, true)] });
  });

  it("keeps an undo queued during a save on the serialized lane, behind the save", async () => {
    const { runtime, ref } = await opened();
    await runtime.edit(ref, [hidden(0, true)]);
    await runtime.edit(ref, [hidden(1, true)]);
    seam.events = [];
    let release!: () => void;
    seam.gate = { promise: new Promise<void>((resolve) => { release = resolve; }), resolve: () => release() };
    const saving = runtime.serialize(ref, { snapshot: snapshot(runtime.snapshot(ref)) });
    const undoing = runtime.undo(ref);
    await vi.waitFor(() => expect(seam.events).toContain("save:start"));
    // The undo's base reopen must not start inside the save.
    expect(seam.events.filter((event) => event === "open")).toEqual([]);
    seam.gate.resolve();
    const [, undone] = await Promise.all([saving, undoing]);
    seam.gate = null;
    expect(undone).toBe(true);
    // The save's verify reopen and the undo's reopen both follow save:end.
    expect(seam.events.indexOf("save:end")).toBeLessThan(seam.events.lastIndexOf("open"));
    expect(runtime.snapshot(ref)).toEqual({ revision: 1, edits: [hidden(0, true)] });
  });

  it("exposes the opened engine deck through the deck accessor", async () => {
    const { runtime, ref } = await opened();
    const deck = runtime.deck(ref);
    expect(deck.slides).toHaveLength(2);
    // F1: the REAL OpenedPptx.deck - it carries the EMU size the canvas scales
    // from; the PptxSessionModel wrapper proxies slides but has no size.
    expect(deck.size).toEqual({ cx: 9144000, cy: 5143500 });
    expect((deck as { fitWidthPx?: number }).fitWidthPx).toBeUndefined();
    const first = deck.slides[0] as { elements: Array<{ id: string; type: string }> };
    expect(first.elements.some((element) => element.id === "t1" && element.type === "text")).toBe(true);

    // The accessor reads the LIVE model: an edit is visible immediately, and a
    // reopen (undo) swaps the engine session the accessor resolves.
    await runtime.edit(ref, [hidden(0, true)]);
    expect((runtime.deck(ref).slides[0] as { hidden?: boolean }).hidden).toBe(true);
    expect(await runtime.undo(ref)).toBe(true);
    expect((runtime.deck(ref).slides[0] as { hidden?: boolean }).hidden).toBeFalsy();

    // A released session refuses the read instead of returning a stale deck.
    await runtime.release(ref);
    expect(() => runtime.deck(ref)).toThrow("pptx_runtime_not_open");
  });

  it("reads the live session's speaker notes and refuses after release", async () => {
    const { runtime, ref } = await opened();
    // A deck without a notesSlide reads the honest empty string.
    expect(runtime.slideNotes!(ref, 0)).toBe("");
    // set_notes lands the text on the live notes part; the read reflects it.
    await runtime.edit(ref, [{ op: "set_notes", slideIndex: 0, text: "Opening remarks" }]);
    expect(runtime.slideNotes!(ref, 0)).toBe("Opening remarks");
    expect(runtime.slideNotes!(ref, 1)).toBe("");
    // Undo reopens the base: the read follows the LIVE engine session.
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.slideNotes!(ref, 0)).toBe("");
    // A missing slide is a typed refusal, never a silent ''. 
    // The engine contract is the typed code (PptxEngineError.code ===
    // "no_slide"); the message prose is not the contract, so assert the code.
    let refusal: unknown;
    try {
      runtime.slideNotes!(ref, 9);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(PptxEngineError);
    expect((refusal as PptxEngineError).code).toBe("no_slide");
    // A released session refuses instead of returning stale notes.
    await runtime.release(ref);
    expect(() => runtime.slideNotes!(ref, 0)).toThrow("pptx_runtime_not_open");
  });

  it("returns the minted element ids from the edit channel, and none for non-creating edits", async () => {
    const { runtime, ref } = await opened();
    const box = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 1, wPx: 10, hPx: 10 });
    const one = await runtime.edit(ref, [box(1)]);
    expect(one.revision).toBe(1);
    expect(one.createdIds).toHaveLength(1);
    const created = one.createdIds![0]!;
    expect(runtime.slides(ref)[0]?.elements.some((element) => element.id === created)).toBe(true);
    // A mixed batch lists ids in edit order and skips the edits that mint none.
    const mixed = await runtime.edit(ref, [hidden(0, true), box(2), box(3)]);
    expect(mixed.createdIds).toHaveLength(2);
    expect(new Set([created, ...mixed.createdIds!]).size).toBe(3);
    expect(await runtime.edit(ref, [hidden(0, false)])).toEqual({ revision: 5 });
  });

  it("reads the live package's slide layouts and refuses after release", async () => {
    const { runtime, ref } = await opened();
    expect(runtime.slideLayouts!(ref)).toEqual([{ name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" }]);
    await runtime.release(ref);
    expect(() => runtime.slideLayouts!(ref)).toThrow("pptx_runtime_not_open");
  });

  it("keeps revision and fingerprint consistent across history", async () => {
    const { runtime, ref } = await opened();
    await runtime.edit(ref, [hidden(0, true)]);
    const firstFp = await fingerprintPptxSnapshot(runtime.snapshot(ref));
    await runtime.edit(ref, [hidden(1, true)]);
    const fullFp = await fingerprintPptxSnapshot(runtime.snapshot(ref));
    expect(fullFp).not.toBe(firstFp);
    await runtime.undo(ref);
    expect(runtime.snapshot(ref).revision).toBe(1);
    // Undo returns to the exact prior state: the fingerprint is stable again.
    expect(await fingerprintPptxSnapshot(runtime.snapshot(ref))).toBe(firstFp);
  });

  // UNI-927 W11a (W10 review F1): a multi-entry edit() is all-or-nothing and
  // one history step.
  it("rolls a batch refused mid-array back so save, undo and redo still agree", async () => {
    const { runtime, ref } = await opened();
    // "t1" is the base deck's text element, so its id is stable across replays.
    const created = "t1";
    await runtime.edit(ref, [{ op: "set_notes", slideIndex: 0, text: "kept" }]);
    await runtime.edit(ref, [{ op: "delete_element", slideIndex: 0, elementId: created }]);
    await runtime.edit(ref, [hidden(1, true)]);
    expect(await runtime.undo(ref)).toBe(true);
    const before = runtime.snapshot(ref);
    expect(before.revision).toBe(2);

    // The 2nd entry targets the element deleted between selection and apply.
    const refused = runtime.edit(ref, [
      hidden(0, true),
      { op: "set_text_anchor", slideIndex: 0, elementId: created, anchor: "middle" },
      hidden(1, true),
    ]);
    await expect(refused).rejects.toMatchObject({ code: "fmt_no_element" });

    // No trace: journal, cursor, revision and the live model are the pre-call state.
    expect(runtime.snapshot(ref)).toEqual(before);
    expect(runtime.slides(ref)[0]?.hidden).toBe(false);
    expect(runtime.slides(ref)[1]?.hidden).toBe(false);
    const saved = await runtime.serialize(ref, { snapshot: { generation: 2, fingerprint: "fp", value: runtime.snapshot(ref) } });
    expect(saved.bytes.length).toBeGreaterThan(0);
    // The refused gesture did not drop the redo tail.
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.slides(ref)[1]?.hidden).toBe(true);
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual(before);

    // A following valid batch lands, is one undo step, and redo replays it whole.
    expect(await runtime.edit(ref, [hidden(0, true), hidden(1, true)])).toEqual({ revision: 4 });
    expect(runtime.snapshot(ref).edits).toHaveLength(4);
    expect(await runtime.redo(ref)).toBe(false);
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual(before);
    expect(runtime.slides(ref)[0]?.hidden).toBe(false);
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.snapshot(ref).revision).toBe(4);
    expect(runtime.slides(ref).map((slide) => slide.hidden)).toEqual([true, true]);
    const tip = runtime.snapshot(ref);
    await expect(runtime.serialize(ref, { snapshot: { generation: 4, fingerprint: "fp", value: tip } })).resolves.toBeDefined();
  });

  it("leaves the session untouched when the first entry of a batch is refused", async () => {
    const { runtime, ref } = await opened();
    await runtime.edit(ref, [hidden(0, true)]);
    const before = runtime.snapshot(ref);
    await expect(runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: "gone", anchor: "top" }, hidden(1, true)]))
      .rejects.toMatchObject({ code: "fmt_no_element" });
    expect(runtime.snapshot(ref)).toEqual(before);
    expect(runtime.slides(ref)[1]?.hidden).toBe(false);
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });
  });
});
