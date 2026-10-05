// UNI-927 W12 - replay-stable element refs for the host pptx edit journal.
import { describe, expect, it } from "vitest";
import {
  annotatePptxReplayRefs,
  isPptxSessionDiverged,
  PPTX_SESSION_DIVERGED,
  PptxEngineError,
  pptxSessionDivergedError,
  resolvePptxReplayRefs,
  type PptxEdit,
  type PptxReplayDeck,
} from "../src/pptx";

/** Two decks with the same shape and different (session-scoped) ids. */
const deckOf = (tag: string): PptxReplayDeck => ({
  slides: [
    { elements: [{ id: `a${tag}` }, { id: `g${tag}`, children: [{ id: `c1${tag}` }, { id: `c2${tag}` }] }] },
    { elements: [{ id: `b${tag}` }] },
  ],
});
const first = deckOf("_1");
const second = deckOf("_2");

describe("pptx replay refs", () => {
  it("records element positions and resolves them onto a deck with fresh ids", () => {
    const edit: PptxEdit = { op: "edit_text", slideIndex: 0, elementId: "c2_1", groupId: "g_1", paragraphs: [{ runs: [{ text: "a_1" }] }] };
    const entry = annotatePptxReplayRefs(first, edit);
    expect(entry).toEqual({ ...edit, __refs: { elementId: "0:1/1", groupId: "0:1" } });
    // Text that happens to equal an id is never rewritten (only id fields are).
    expect(resolvePptxReplayRefs(second, entry)).toEqual({ ...edit, elementId: "c2_2", groupId: "g_2" });
    // On the deck it was recorded on, resolution is the identity.
    expect(resolvePptxReplayRefs(first, entry)).toEqual(edit);
  });

  it("covers id arrays, nested sourceIds and ids on another slide", () => {
    const group: PptxEdit = { op: "group_elements", slideIndex: 0, elementIds: ["a_1", "gone", "c1_1"] };
    const annotated = annotatePptxReplayRefs(first, group);
    expect(resolvePptxReplayRefs(second, annotated)).toEqual({ ...group, elementIds: ["a_2", "gone", "c1_2"] });

    const animations = {
      op: "set_animations",
      slideIndex: 1,
      items: [{ sourceId: "b_1", effect: "fade", trigger: "onClick", durationMs: 1, delayMs: 0 }],
    } as unknown as PptxEdit;
    const resolved = resolvePptxReplayRefs(second, annotatePptxReplayRefs(first, animations)) as unknown as { items: Array<{ sourceId: string }> };
    expect(resolved.items[0]?.sourceId).toBe("b_2");
    // The source edit is never mutated.
    expect((animations as unknown as { items: Array<{ sourceId: string }> }).items[0]?.sourceId).toBe("b_1");
  });

  it("leaves element-free edits and unknown ids unannotated, and drops caller-sent refs", () => {
    const hide: PptxEdit = { op: "set_slide_hidden", slideIndex: 0, hidden: true };
    expect(annotatePptxReplayRefs(first, hide)).toEqual(hide);
    const gone: PptxEdit = { op: "delete_element", slideIndex: 0, elementId: "gone" };
    expect(annotatePptxReplayRefs(first, gone)).toEqual(gone);
    const forged = { ...gone, __refs: { elementId: "1:0" } } as unknown as PptxEdit;
    expect(annotatePptxReplayRefs(first, forged)).toEqual(gone);
    // A ref-less (pre-W12) entry passes through untouched.
    expect(resolvePptxReplayRefs(second, gone)).toEqual(gone);
    const image = { op: "add_image", slideIndex: 0, bytes: new Uint8Array([1]), ext: "png", xPx: 0, yPx: 0, wPx: 1, hPx: 1 } as PptxEdit;
    expect(annotatePptxReplayRefs(first, image)).toEqual(image);
  });

  it("refuses a position the replayed deck does not hold", () => {
    const entry = annotatePptxReplayRefs(first, { op: "delete_element", slideIndex: 0, elementId: "c2_1" });
    const smaller: PptxReplayDeck = { slides: [{ elements: [{ id: "a" }, { id: "g", children: [{ id: "c1" }] }] }] };
    expect(() => resolvePptxReplayRefs(smaller, entry)).toThrow(expect.objectContaining({ code: "pptx_replay_ref_unresolved" }));
    const noId: PptxReplayDeck = { slides: [{ elements: [{}] }] };
    const top = annotatePptxReplayRefs(first, { op: "delete_element", slideIndex: 0, elementId: "a_1" });
    expect(() => resolvePptxReplayRefs(noId, top)).toThrow(expect.objectContaining({ code: "pptx_replay_ref_unresolved" }));
  });

  it("refuses malformed refs from a hand-edited draft", () => {
    const base = { op: "delete_element", slideIndex: 0, elementId: "a" };
    const cases: unknown[] = [
      { ...base, __refs: ["0:0"] },
      { ...base, __refs: "0:0" },
      { ...base, __refs: { elementId: 3 } },
      { ...base, __refs: { slideIndex: "0:0" } },
      { ...base, __refs: { missing: "0:0" } },
      { ...base, __refs: { "__proto__.x": "0:0" } },
      { ...base, __refs: { "elementId.x": "0:0" } },
    ];
    for (const entry of cases) {
      expect(() => resolvePptxReplayRefs(second, entry as PptxEdit)).toThrow(expect.objectContaining({ code: "pptx_replay_refs_invalid" }));
    }
    expect(() => resolvePptxReplayRefs(second, { ...base, __refs: { elementId: "not-a-token" } } as unknown as PptxEdit))
      .toThrow(expect.objectContaining({ code: "pptx_replay_ref_unresolved" }));
  });

  it("builds and recognizes the diverged-session refusal", () => {
    const cause = new PptxEngineError("fmt_no_element", "gone");
    const error = pptxSessionDivergedError(cause);
    expect(error.code).toBe(PPTX_SESSION_DIVERGED);
    expect(error.message).toContain("fmt_no_element");
    expect((error as { cause?: unknown }).cause).toBe(cause);
    expect(isPptxSessionDiverged(error)).toBe(true);
    expect(pptxSessionDivergedError(new Error("plain")).message).toContain("plain");
    expect(pptxSessionDivergedError("text").message).toContain("text");
    expect(isPptxSessionDiverged(cause)).toBe(false);
    expect(isPptxSessionDiverged(new Error(PPTX_SESSION_DIVERGED))).toBe(false);
  });
});
