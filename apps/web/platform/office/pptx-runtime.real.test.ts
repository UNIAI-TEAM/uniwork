/** @vitest-environment node */
// UNI-927 W12 (W11 review F1) - the web runtime on the REAL vendored engine
// (nothing mocked: @uniwork/office-upstream/pptx-renderer is the generated
// artifact). The real engine re-mints every parsed id on each open and every
// inserted id on each apply, which the fake engines never did; this proves
// insert -> format(created id) and format(parsed element) survive the
// reopen-and-replay that undo, redo and save run.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPptx } from "@uniwork/office-upstream/pptx-renderer";
import { isSlideHidden, type PptxEdit } from "@uniwork/office-engine/pptx";
import { createWebPptxSessionRuntime } from "./pptx-runtime";

// vitest runs with cwd = apps/web.
const fixture = () => new Uint8Array(readFileSync(resolve(process.cwd(), "../../docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx")));

interface RealElement {
  id: string;
  type: string;
  text?: { anchor?: string };
}

const elementsOf = (deck: unknown, slideIndex = 0): RealElement[] =>
  ((deck as { slides: Array<{ elements: RealElement[] }> }).slides[slideIndex]?.elements ?? []);

describe("web PPTX runtime on the real engine - replay-stable ids (W12)", () => {
  it("replays insert -> format(created) and format(parsed) through undo, redo, save and reopen", async () => {
    const runtime = createWebPptxSessionRuntime({ documentId: "real" });
    const result = await runtime.open({ bytes: fixture(), documentId: "real" });
    if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
    const ref = result.document_model_ref;
    const baseCount = elementsOf(runtime.deck(ref)).length;
    const parsed = elementsOf(runtime.deck(ref)).find((element) => element.type === "text" || element.type === "shape");
    if (!parsed) throw new Error("fixture slide 1 has no text/shape element");
    const parsedIndex = elementsOf(runtime.deck(ref)).indexOf(parsed);

    const insert: PptxEdit = { op: "add_element", slideIndex: 0, kind: "rect", xPx: 40, yPx: 40, wPx: 120, hPx: 60 };
    const created = (await runtime.edit(ref, [insert])).createdIds?.[0];
    expect(created).toBeTruthy();
    await runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: created!, anchor: "middle" }]);
    await runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: parsed.id, anchor: "bottom" }]);
    // A trailing non-element step, so the first undo replays all three above.
    // (Hidden-slide state on the real model is covered by the next test.)
    await runtime.edit(ref, [{ op: "set_slide_hidden", slideIndex: 1, hidden: true }]);

    // Undo = reopen the base (every parsed id re-minted) + replay three
    // element-targeted entries; before W12 the first one missed.
    expect(await runtime.undo(ref)).toBe(true);
    const live = elementsOf(runtime.deck(ref));
    expect(live).toHaveLength(baseCount + 1);
    expect(live[parsedIndex]?.id).not.toBe(parsed.id);
    expect(live[parsedIndex]?.text?.anchor).toBe("bottom");
    expect(live.at(-1)?.id).not.toBe(created);
    expect(live.at(-1)?.text?.anchor).toBe("middle");

    // Two more undos (replays of [insert, format] and [insert]), then redo both.
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.undo(ref)).toBe(true);
    expect(elementsOf(runtime.deck(ref)).at(-1)?.text?.anchor).not.toBe("middle");
    expect(await runtime.redo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);

    // Save the tip and reopen the bytes independently: the formats landed.
    const value = runtime.snapshot(ref);
    expect(value.revision).toBe(4);
    const out = await runtime.serialize(ref, { snapshot: { generation: 4, fingerprint: "fp", value } });
    const reopened = await openPptx(out.bytes);
    const saved = elementsOf(reopened.deck);
    expect(saved).toHaveLength(baseCount + 1);
    expect(saved[parsedIndex]?.text?.anchor).toBe("bottom");
    expect(saved.at(-1)?.text?.anchor).toBe("middle");

    // The recovered-draft path: a fresh runtime (its own reopened ids) replays
    // the snapshot journal onto the base bytes.
    const fresh = createWebPptxSessionRuntime({ documentId: "real" });
    const second = await fresh.open({ bytes: fixture(), documentId: "real" });
    if (second.outcome !== "opened" || !second.document_model_ref) throw new Error("second open failed");
    await fresh.restore!(second.document_model_ref, JSON.parse(JSON.stringify(value)) as typeof value);
    const restored = elementsOf(fresh.deck(second.document_model_ref));
    expect(restored[parsedIndex]?.text?.anchor).toBe("bottom");
    expect(restored.at(-1)?.text?.anchor).toBe("middle");
    await runtime.release(ref);
    await fresh.release(second.document_model_ref);
  }, 60_000);
});

describe("web PPTX runtime on the real engine - whole-slide reparse (W12c)", () => {
  it("replays an element edit that follows group_elements (every id on the slide re-minted)", async () => {
    const runtime = createWebPptxSessionRuntime({ documentId: "real-reparse" });
    const result = await runtime.open({ bytes: fixture(), documentId: "real-reparse" });
    if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
    const ref = result.document_model_ref;
    const baseElements = [...elementsOf(runtime.deck(ref))]; // the engine mutates the live array in place
    const parsedIndex = baseElements.findIndex((element) => element.type === "text" || element.type === "shape");
    if (parsedIndex < 0) throw new Error("fixture slide 1 has no text/shape element");

    const rect = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 40, wPx: 60, hPx: 40 });
    const first = (await runtime.edit(ref, [rect(40)])).createdIds?.[0];
    const second = (await runtime.edit(ref, [rect(120)])).createdIds?.[0];
    expect(first && second).toBeTruthy();
    const beforeGroup = elementsOf(runtime.deck(ref)).map((element) => element.id);
    await runtime.edit(ref, [{ op: "group_elements", slideIndex: 0, elementIds: [first!, second!] }]);
    // The engine re-parsed the slide: even untouched elements carry new ids.
    const grouped = elementsOf(runtime.deck(ref));
    expect(grouped[parsedIndex]?.id).not.toBe(beforeGroup[parsedIndex]);
    expect(grouped).toHaveLength(baseElements.length + 1);
    // The next edit targets an element by its post-reparse id.
    await runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: grouped[parsedIndex]!.id, anchor: "bottom" }]);

    const tip = elementsOf(runtime.deck(ref));
    expect(tip[parsedIndex]?.text?.anchor).toBe("bottom");
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.undo(ref)).toBe(true);
    expect(elementsOf(runtime.deck(ref))).toHaveLength(baseElements.length + 2);
    expect(await runtime.redo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);
    const redone = elementsOf(runtime.deck(ref));
    expect(redone).toHaveLength(baseElements.length + 1);
    expect(redone[parsedIndex]?.text?.anchor).toBe("bottom");

    const value = runtime.snapshot(ref);
    expect(value.revision).toBe(4);
    const out = await runtime.serialize(ref, { snapshot: { generation: 4, fingerprint: "fp", value } });
    const saved = elementsOf((await openPptx(out.bytes)).deck);
    expect(saved).toHaveLength(baseElements.length + 1);
    expect(saved[parsedIndex]?.text?.anchor).toBe("bottom");

    // The recovered-draft path replays the same journal onto a fresh open.
    const fresh = createWebPptxSessionRuntime({ documentId: "real-reparse" });
    const reopened = await fresh.open({ bytes: fixture(), documentId: "real-reparse" });
    if (reopened.outcome !== "opened" || !reopened.document_model_ref) throw new Error("second open failed");
    await fresh.restore!(reopened.document_model_ref, JSON.parse(JSON.stringify(value)) as typeof value);
    expect(elementsOf(fresh.deck(reopened.document_model_ref))[parsedIndex]?.text?.anchor).toBe("bottom");
    await runtime.release(ref);
    await fresh.release(reopened.document_model_ref);
  }, 60_000);
});

describe("web PPTX runtime on the real engine - hidden slides (W13)", () => {
  const hiddenOf = (runtime: ReturnType<typeof createWebPptxSessionRuntime>, ref: string): boolean[] => runtime.slides(ref).map((slide) => slide.hidden);

  it("reports show=\"0\" in slides() through edit, undo, redo, unhide, save and reopen", async () => {
    const runtime = createWebPptxSessionRuntime({ documentId: "real-hidden" });
    const result = await runtime.open({ bytes: fixture(), documentId: "real-hidden" });
    if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
    const ref = result.document_model_ref;
    const visible = hiddenOf(runtime, ref);
    expect(visible.length).toBeGreaterThan(1);
    expect(visible.every((hidden) => !hidden)).toBe(true);

    // The real slide model never carries a hidden flag; the engine patches the <p:sld> tag.
    await runtime.edit(ref, [{ op: "set_slide_hidden", slideIndex: 1, hidden: true }]);
    const slide = (runtime.deck(ref) as { slides: Array<{ hidden?: boolean; bodyPrefix?: string }> }).slides[1];
    expect(slide?.hidden).toBeUndefined();
    expect(isSlideHidden(slide ?? {})).toBe(true);
    const hiddenOnly = visible.map((_, index) => index === 1);
    expect(hiddenOf(runtime, ref)).toEqual(hiddenOnly);

    expect(await runtime.undo(ref)).toBe(true);
    expect(hiddenOf(runtime, ref)).toEqual(visible);
    expect(await runtime.redo(ref)).toBe(true);
    expect(hiddenOf(runtime, ref)).toEqual(hiddenOnly);

    // Saved and reopened bytes still say hidden (a fresh session, a fresh parse).
    const value = runtime.snapshot(ref);
    const out = await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value } });
    const reopened = await openPptx(out.bytes);
    expect((reopened.deck.slides as Array<{ hidden?: boolean; bodyPrefix?: string }>).map((entry) => isSlideHidden(entry))).toEqual(hiddenOnly);
    const second = createWebPptxSessionRuntime({ documentId: "real-hidden" });
    const again = await second.open({ bytes: out.bytes, documentId: "real-hidden" });
    if (again.outcome !== "opened" || !again.document_model_ref) throw new Error("saved deck did not reopen");
    expect(hiddenOf(second, again.document_model_ref)).toEqual(hiddenOnly);

    // The sorter toggle sends hidden:false once it reads true; the slide shows again.
    await second.edit(again.document_model_ref, [{ op: "set_slide_hidden", slideIndex: 1, hidden: false }]);
    expect(hiddenOf(second, again.document_model_ref)).toEqual(visible);
    await runtime.release(ref);
    await second.release(again.document_model_ref);
  }, 60_000);
});

describe("web PPTX runtime on the real engine - save-point rebase (W14)", () => {
  it("recovers a post-save draft onto the saved bytes without replaying the saved edits again", async () => {
    const runtime = createWebPptxSessionRuntime({ documentId: "real-rebase" });
    const result = await runtime.open({ bytes: fixture(), documentId: "real-rebase" });
    if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
    const ref = result.document_model_ref;
    const baseCount = elementsOf(runtime.deck(ref)).length;
    const parsedIndex = elementsOf(runtime.deck(ref)).findIndex((element) => element.type === "text" || element.type === "shape");
    if (parsedIndex < 0) throw new Error("fixture slide 1 has no text/shape element");

    // Before the save: add_element + a format of it + a format of a parsed element.
    const insert = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 40, wPx: 120, hPx: 60 });
    const created = (await runtime.edit(ref, [insert(40)])).createdIds?.[0];
    expect(created).toBeTruthy();
    await runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: created!, anchor: "middle" }]);
    await runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: elementsOf(runtime.deck(ref))[parsedIndex]!.id, anchor: "bottom" }]);

    // Save: serialize for the intent, then the commit hook the transport calls.
    const value = runtime.snapshot(ref);
    const saved = await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value }, intentId: "intent-1" });
    await runtime.setBaseRevision!(ref, "2", "intent-1");
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });

    // After the save: re-format the element the saved prefix created, insert another.
    await runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: elementsOf(runtime.deck(ref))[baseCount]!.id, anchor: "top" }]);
    await runtime.edit(ref, [insert(200)]);
    const draft = JSON.parse(JSON.stringify(runtime.snapshot(ref))) as ReturnType<typeof runtime.snapshot>;
    expect(draft.edits).toHaveLength(2);

    // Crash -> a fresh runtime on the SAVED bytes (the new base) -> recover.
    const fresh = createWebPptxSessionRuntime({ documentId: "real-rebase" });
    const second = await fresh.open({ bytes: saved.bytes, documentId: "real-rebase" });
    if (second.outcome !== "opened" || !second.document_model_ref) throw new Error("saved deck did not reopen");
    await fresh.restore!(second.document_model_ref, draft);

    // Serialize the recovered deck and reopen it with the engine itself.
    const recovered = fresh.snapshot(second.document_model_ref);
    const out = await fresh.serialize(second.document_model_ref, { snapshot: { generation: 1, fingerprint: "fp", value: recovered } });
    const reopened = elementsOf((await openPptx(out.bytes)).deck);
    expect(reopened).toHaveLength(baseCount + 2);
    expect(reopened[parsedIndex]?.text?.anchor).toBe("bottom");
    expect(reopened[baseCount]?.text?.anchor).toBe("top");
    expect(reopened[baseCount + 1]?.text?.anchor).not.toBe("top");
    // The same deck the live session would save.
    const live = elementsOf(runtime.deck(ref));
    expect(live).toHaveLength(baseCount + 2);
    expect(reopened.map((element) => [element.type, element.text?.anchor])).toEqual(live.map((element) => [element.type, element.text?.anchor]));
    await runtime.release(ref);
    await fresh.release(second.document_model_ref);
  }, 60_000);
});

describe("web PPTX runtime on the real engine - panel read-back (X1)", () => {
  const slidesFixture = (name: string) => new Uint8Array(readFileSync(resolve(process.cwd(), "../../docs/office/g0/fixtures/files/slides/" + name)));
  type Runtime = ReturnType<typeof createWebPptxSessionRuntime>;
  const openFixture = async (bytes: Uint8Array, id: string): Promise<{ runtime: Runtime; ref: string }> => {
    const runtime = createWebPptxSessionRuntime({ documentId: id });
    const result = await runtime.open({ bytes, documentId: id });
    if (result.outcome !== "opened" || !result.document_model_ref) throw new Error(id + " did not open: " + String(result.message));
    return { runtime, ref: result.document_model_ref };
  };
  const saveBytes = async (runtime: Runtime, ref: string): Promise<Uint8Array> => {
    const value = runtime.snapshot(ref);
    return (await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value } })).bytes;
  };

  it("reads the existing speaker notes and follows set_notes through undo, redo, save and reopen (R2-3)", async () => {
    const { runtime, ref } = await openFixture(slidesFixture("pptx-notes.pptx"), "real-notes");
    // The fixture's notes shape has no type="body" placeholder; the vendored read alone answered ''.
    expect(runtime.slideNotes!(ref, 0)).toBe("Ghi chú trình bày cho buổi họp tuần.");
    await runtime.edit(ref, [{ op: "set_notes", slideIndex: 0, text: "Ghi chú mới\ndòng hai" } as PptxEdit]);
    expect(runtime.slideNotes!(ref, 0)).toBe("Ghi chú mới\ndòng hai");
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.slideNotes!(ref, 0)).toBe("Ghi chú trình bày cho buổi họp tuần.");
    expect(await runtime.redo(ref)).toBe(true);
    const saved = await saveBytes(runtime, ref);
    const reopened = await openFixture(saved, "real-notes-2");
    expect(reopened.runtime.slideNotes!(reopened.ref, 0)).toBe("Ghi chú mới\ndòng hai");
    // Clearing the notes reads '' - the older placeholder-less text never comes back.
    await reopened.runtime.edit(reopened.ref, [{ op: "set_notes", slideIndex: 0, text: "" } as PptxEdit]);
    expect(reopened.runtime.slideNotes!(reopened.ref, 0)).toBe("");
    await runtime.release(ref);
    await reopened.runtime.release(reopened.ref);
  }, 60_000);

  it("reads the slide transition and advance time through edit, undo, redo, save and reopen (R2-1)", async () => {
    const { runtime, ref } = await openFixture(fixture(), "real-transition");
    expect(runtime.slideTransition!(ref, 0)).toEqual({ kind: "none", advanceMs: null });
    await runtime.edit(ref, [{ op: "set_transition", slideIndex: 0, kind: "fade" } as PptxEdit]);
    await runtime.edit(ref, [{ op: "set_advance_time", slideIndex: 0, ms: 3000 } as PptxEdit]);
    expect(runtime.slideTransition!(ref, 0)).toEqual({ kind: "fade", advanceMs: 3000 });
    expect(runtime.slideTransition!(ref, 1)).toEqual({ kind: "none", advanceMs: null });
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.slideTransition!(ref, 0)).toEqual({ kind: "fade", advanceMs: null });
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.slideTransition!(ref, 0)).toEqual({ kind: "none", advanceMs: null });
    expect(await runtime.redo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.slideTransition!(ref, 0)).toEqual({ kind: "fade", advanceMs: 3000 });
    const reopened = await openFixture(await saveBytes(runtime, ref), "real-transition-2");
    expect(reopened.runtime.slideTransition!(reopened.ref, 0)).toEqual({ kind: "fade", advanceMs: 3000 });
    expect(() => runtime.slideTransition!(ref, 99)).toThrow(/slide index 99/);
    await runtime.release(ref);
    await reopened.runtime.release(reopened.ref);
  }, 60_000);

  it("lists the fixture's existing animation and an added one through undo, redo, save and reopen (R2-2)", async () => {
    const { runtime, ref } = await openFixture(slidesFixture("pptx-animations.pptx"), "real-anim");
    const target = elementsOf(runtime.deck(ref)).find((element) => /<p:cNvPr\s[^>]*\bid="2"/.test(String((element as { anchor?: { originalXml?: string } }).anchor?.originalXml)));
    if (!target) throw new Error("fixture has no shape with cNvPr id 2");
    const existing = { spid: 2, elementId: target.id, effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 };
    expect(runtime.slideAnimations!(ref, 0)).toEqual([existing]);
    await runtime.edit(ref, [{ op: "add_animation", slideIndex: 0, elementId: target.id, effect: "zoom", trigger: "afterPrev", durationMs: 700, delayMs: 200 } as PptxEdit]);
    const added = runtime.slideAnimations!(ref, 0);
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ spid: 2, effect: "zoom", trigger: "afterPrev", durationMs: 700, delayMs: 200 });
    // Undo reopens the base: the ids are re-minted, the read follows the live deck.
    expect(await runtime.undo(ref)).toBe(true);
    const undone = runtime.slideAnimations!(ref, 0);
    expect(undone).toHaveLength(1);
    expect(elementsOf(runtime.deck(ref)).some((element) => element.id === undone[0]?.elementId)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.slideAnimations!(ref, 0)).toHaveLength(2);
    const reopened = await openFixture(await saveBytes(runtime, ref), "real-anim-2");
    const read = reopened.runtime.slideAnimations!(reopened.ref, 0);
    expect(read.map((entry) => entry.effect)).toEqual(["fade", "zoom"]);
    expect(read.every((entry) => elementsOf(reopened.runtime.deck(reopened.ref)).some((element) => element.id === entry.elementId))).toBe(true);
    await runtime.release(ref);
    await reopened.runtime.release(reopened.ref);
  }, 60_000);

  it("add_connector glues a p:cxnSp to two shapes and survives undo, redo, save and reopen (R4fix-connector-engine)", async () => {
    const runtime = createWebPptxSessionRuntime({ documentId: "real-connector" });
    const result = await runtime.open({ bytes: fixture(), documentId: "real-connector" });
    if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
    const ref = result.document_model_ref;
    const baseCount = elementsOf(runtime.deck(ref)).length;
    const rect = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 300, wPx: 80, hPx: 50 });
    const a = (await runtime.edit(ref, [rect(40)])).createdIds?.[0];
    const b = (await runtime.edit(ref, [rect(400)])).createdIds?.[0];
    expect(a && b).toBeTruthy();
    await runtime.edit(ref, [{ op: "add_connector", slideIndex: 0, elementIds: [a!, b!], kind: "elbow", arrow: "end" }]);
    const xmlOf = (element: RealElement | undefined): string =>
      String((element as unknown as { anchor?: { originalXml?: string } } | undefined)?.anchor?.originalXml ?? "");
    const tip = elementsOf(runtime.deck(ref));
    expect(tip).toHaveLength(baseCount + 3);
    const glued = xmlOf(tip.at(-1));
    expect(glued).toContain("<p:cxnSp");
    expect(glued).toMatch(/<a:stCxn id="\d+" idx="\d+"\/>/);
    expect(glued).toMatch(/<a:endCxn id="\d+" idx="\d+"\/>/);
    expect(glued).toContain('prst="bentConnector3"');
    // Moving a glued shape re-routes the connector (vendored setTransform -> updateConnectorsForMoved).
    const offsetOf = (element: RealElement | undefined) => (element as unknown as { transform: { offset: { x: number; y: number; cx: number; cy: number } } }).transform.offset;
    const before = { ...offsetOf(tip.at(-1)) };
    await runtime.edit(ref, [{ op: "edit_transform", slideIndex: 0, elementId: b!, xPx: 400, yPx: 120, wPx: 80, hPx: 50 }]);
    const moved = elementsOf(runtime.deck(ref)).at(-1);
    expect(offsetOf(moved)).not.toEqual(before);
    expect(xmlOf(moved)).toContain("<a:endCxn");
    expect(await runtime.undo(ref)).toBe(true);
    expect(offsetOf(elementsOf(runtime.deck(ref)).at(-1))).toEqual(before);

    // Undo removes it (reopen + replay of the two inserts); redo re-glues it.
    expect(await runtime.undo(ref)).toBe(true);
    expect(elementsOf(runtime.deck(ref))).toHaveLength(baseCount + 2);
    expect(elementsOf(runtime.deck(ref)).some((element) => xmlOf(element).includes("<p:cxnSp"))).toBe(false);
    expect(await runtime.redo(ref)).toBe(true);
    expect(xmlOf(elementsOf(runtime.deck(ref)).at(-1))).toContain("<a:endCxn");

    const value = runtime.snapshot(ref);
    const out = await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value } });
    const saved = elementsOf((await openPptx(out.bytes)).deck);
    expect(saved).toHaveLength(baseCount + 3);
    const savedXml = xmlOf(saved.at(-1));
    expect(savedXml).toContain("<p:cxnSp");
    expect(savedXml).toContain("<a:stCxn");
    expect(savedXml).toContain("<a:endCxn");
    await runtime.release(ref);
  }, 60_000);
});
