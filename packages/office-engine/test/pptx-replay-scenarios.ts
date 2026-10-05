// UNI-927 W12 (W11 review F1) - replay-stable element ids + the poison guard,
// shared by the web and desktop runtime tests (the two runtimes are mirrors).
//
// The fake engine keeps parsed ids stable across reopens, which hid F1. The
// "real-id" seam mode mimics the vendored engine instead: every open re-mints
// every parsed element id (parse.ts uid('sp') from a module counter) and every
// insert mints a fresh id per apply (insert.ts spnew_<n>_<time>), so a journal
// that replayed caller ids verbatim would miss on the first element entry.
import { expect, it } from "vitest";
import { isSlideHidden, type PptxEdit } from "../src/pptx";
import { decodeFakePptx } from "./fake-pptx-engine";

interface ReplayElement {
  id: string;
  anchor?: string;
  children?: ReplayElement[];
}

/** The artifact-seam controls a runtime test file wires into its vi.mock. */
export interface ReplaySeam {
  /** Re-mint every parsed id on each open (the real engine's behavior). */
  realIds: boolean;
  /** Make every live runTxn carrying this vendored op throw (forced replay failure). */
  breakOp: string | null;
  /** Count of savePptx calls that started. */
  saves: number;
}

interface RuntimeLike {
  edit(ref: string, edits: readonly PptxEdit[]): Promise<{ revision: number; createdIds?: string[] }>;
  undo(ref: string): Promise<boolean>;
  redo(ref: string): Promise<boolean>;
  restore?(ref: string, snapshot: { revision: number; edits: Array<{ op: string; [key: string]: unknown }> }): Promise<void>;
  snapshot(ref: string): { revision: number; edits: Array<{ op: string; [key: string]: unknown }> };
  serialize(ref: string, input: { snapshot: { generation: number; fingerprint: string; value: ReturnType<RuntimeLike["snapshot"]> } }): Promise<{ bytes: Uint8Array }>;
  slides(ref: string): Array<{ elements: Array<{ id: string; type: string }> }>;
  deck(ref: string): unknown;
}

/** Re-mint every element id of a freshly opened deck, groups included. */
export function remintElementIds(deck: { slides: Array<{ elements?: ReplayElement[] }> }, tag: string): void {
  const walk = (elements: ReplayElement[] | undefined): void => {
    for (const element of elements ?? []) {
      element.id = `${element.id}~${tag}`;
      walk(element.children);
    }
  };
  for (const slide of deck.slides) walk(slide.elements);
}

const box = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 1, wPx: 10, hPx: 10 });
const anchor = (elementId: string, value: "top" | "middle" | "bottom" = "middle"): PptxEdit => ({
  op: "set_text_anchor",
  slideIndex: 0,
  elementId,
  anchor: value,
});
const hidden = (slideIndex: number, value: boolean): PptxEdit => ({ op: "set_slide_hidden", slideIndex, hidden: value });

function liveElements(runtime: RuntimeLike, ref: string, slideIndex = 0): ReplayElement[] {
  return ((runtime.deck(ref) as { slides: Array<{ elements: ReplayElement[] }> }).slides[slideIndex]?.elements ?? []);
}

async function save(runtime: RuntimeLike, ref: string) {
  const value = runtime.snapshot(ref);
  const out = await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value } });
  return decodeFakePptx(out.bytes);
}

/** Register the four F1 scenarios against one runtime's mocked seam. */
export function registerReplayIdScenarios(
  seam: ReplaySeam,
  opened: () => Promise<{ runtime: RuntimeLike; ref: string }>,
): void {
  const realOpen = async () => {
    seam.realIds = true;
    seam.breakOp = null;
    return opened();
  };

  it("replays insert -> format(created id) through undo, redo and save on re-minted ids", async () => {
    const { runtime, ref } = await realOpen();
    const created = (await runtime.edit(ref, [box(5)])).createdIds![0]!;
    await runtime.edit(ref, [anchor(created)]);
    await runtime.edit(ref, [hidden(1, true)]);

    // Undo replays [insert, format] onto a reopened base: the insert mints a
    // NEW id there, and the format entry must follow it.
    expect(await runtime.undo(ref)).toBe(true);
    const inserted = liveElements(runtime, ref).at(-1)!;
    expect(inserted.id).not.toBe(created);
    expect(inserted.anchor).toBe("middle");
    expect(runtime.snapshot(ref).revision).toBe(2);

    // Undo the format too (replay of the insert alone), then redo it onto the
    // live session, whose id is different again.
    expect(await runtime.undo(ref)).toBe(true);
    expect(liveElements(runtime, ref).at(-1)!.anchor).toBeUndefined();
    expect(await runtime.redo(ref)).toBe(true);
    expect(liveElements(runtime, ref).at(-1)!.anchor).toBe("middle");
    expect(await runtime.redo(ref)).toBe(true);

    const saved = await save(runtime, ref);
    const elements = (saved.slides[0]?.elements ?? []) as unknown as ReplayElement[];
    expect(elements.at(-1)?.anchor).toBe("middle");
    expect(isSlideHidden(saved.slides[1] ?? {})).toBe(true);
  });

  it("replays a format of a PARSED element through undo and redo after the reopen renamed it", async () => {
    const { runtime, ref } = await realOpen();
    const parsed = liveElements(runtime, ref).find((element) => element.id.startsWith("t1~"))!;
    await runtime.edit(ref, [anchor(parsed.id, "bottom")]);
    await runtime.edit(ref, [hidden(1, true)]);
    expect(await runtime.undo(ref)).toBe(true);
    const renamed = liveElements(runtime, ref).find((element) => element.id.startsWith("t1~"))!;
    expect(renamed.id).not.toBe(parsed.id);
    expect(renamed.anchor).toBe("bottom");
    expect(await runtime.undo(ref)).toBe(true);
    expect(liveElements(runtime, ref).find((element) => element.id.startsWith("t1~"))!.anchor).toBeUndefined();
    expect(await runtime.redo(ref)).toBe(true);
    expect(liveElements(runtime, ref).find((element) => element.id.startsWith("t1~"))!.anchor).toBe("bottom");
    expect(await runtime.redo(ref)).toBe(true);
    expect(isSlideHidden((await save(runtime, ref)).slides[1] ?? {})).toBe(true);
  });

  it("rolls a mid-batch refusal back over an element-bearing journal prefix", async () => {
    const { runtime, ref } = await realOpen();
    const created = (await runtime.edit(ref, [box(5)])).createdIds![0]!;
    await runtime.edit(ref, [anchor(created)]);
    const before = runtime.snapshot(ref);

    // The rollback reopens the base and replays [insert, format(created)].
    const live = liveElements(runtime, ref).at(-1)!.id;
    await expect(runtime.edit(ref, [hidden(0, true), anchor(live, "top"), anchor("gone")]))
      .rejects.toMatchObject({ code: "fmt_no_element" });
    expect(runtime.snapshot(ref)).toEqual(before);
    const rolledBack = liveElements(runtime, ref).at(-1)!;
    expect(rolledBack.id).not.toBe(live);
    expect(rolledBack.anchor).toBe("middle");
    expect(runtime.slides(ref)).toHaveLength(2);

    // The session is healthy: undo/redo/edit/save all still work.
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);
    await runtime.edit(ref, [anchor(liveElements(runtime, ref).at(-1)!.id, "top")]);
    const saved = await save(runtime, ref);
    expect(((saved.slides[0]?.elements ?? []) as unknown as ReplayElement[]).at(-1)?.anchor).toBe("top");
  });

  it("poisons the session when a replay fails after the engine swap: nothing is serialized again", async () => {
    const { runtime, ref } = await realOpen();
    const parsed = liveElements(runtime, ref).find((element) => element.id.startsWith("t1~"))!;
    await runtime.edit(ref, [anchor(parsed.id)]);
    await runtime.edit(ref, [hidden(1, true)]);
    const intended = runtime.snapshot(ref);

    // Undo's reopen succeeds, then the replay of the format entry throws.
    seam.breakOp = "setTextAnchor";
    const diverged = { code: "pptx_session_diverged" };
    await expect(runtime.undo(ref)).rejects.toMatchObject(diverged);
    seam.breakOp = null;

    const savesBefore = seam.saves;
    await expect(runtime.edit(ref, [hidden(0, true)])).rejects.toMatchObject(diverged);
    await expect(runtime.undo(ref)).rejects.toMatchObject(diverged);
    await expect(runtime.redo(ref)).rejects.toMatchObject(diverged);
    await expect(runtime.restore!(ref, intended)).rejects.toMatchObject(diverged);
    await expect(runtime.serialize(ref, { snapshot: { generation: 1, fingerprint: "fp", value: { revision: 0, edits: [] } } }))
      .rejects.toMatchObject(diverged);
    await expect(runtime.serialize(ref, { snapshot: { generation: 2, fingerprint: "fp", value: intended } }))
      .rejects.toMatchObject(diverged);
    expect(seam.saves).toBe(savesBefore);
    // The snapshot still reads the intended journal (a draft keeps the work).
    expect(runtime.snapshot(ref)).toEqual(intended);
  });

  it("poisons a rollback whose replay fails after the swap instead of rethrowing the refusal", async () => {
    const { runtime, ref } = await realOpen();
    const parsed = liveElements(runtime, ref).find((element) => element.id.startsWith("t1~"))!;
    await runtime.edit(ref, [anchor(parsed.id)]);
    seam.breakOp = "setTextAnchor";
    // Entry 0 lands, entry 1 refuses (the break), the rollback replay of the
    // journal's format entry refuses too -> diverged, not the original error.
    await expect(runtime.edit(ref, [hidden(0, true), anchor(parsed.id, "top")])).rejects.toMatchObject({ code: "pptx_session_diverged" });
    seam.breakOp = null;
    await expect(runtime.edit(ref, [hidden(1, true)])).rejects.toMatchObject({ code: "pptx_session_diverged" });
  });
}
