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
  serialize(ref: string, input: { snapshot: { generation: number; fingerprint: string; value: ReturnType<RuntimeLike["snapshot"]> }; intentId?: string }): Promise<{ bytes: Uint8Array }>;
  setBaseRevision?(ref: string, revision: string, intentId: string): Promise<void>;
  releaseSave?(ref: string, intentId: string): Promise<void>;
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

/** The deck a session would save, canonical: keys sorted, element ids
 * stripped (ids are session-scoped; a reopen re-mints them). */
async function savedShape(runtime: RuntimeLike, ref: string): Promise<string> {
  const deck = await save(runtime, ref);
  return JSON.stringify(deck.slides, (key, value: unknown) => {
    if (key === "id") return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  });
}

/** UNI-927 W14: the save-point rebase, registered against one runtime's seam.
 * `openOn(bytes)` opens a fresh runtime on those bytes (the fixture when omitted). */
export function registerSaveRebaseScenarios(
  seam: ReplaySeam,
  openOn: (bytes?: Uint8Array) => Promise<{ runtime: RuntimeLike; ref: string }>,
): void {
  const realOpen = async (bytes?: Uint8Array) => {
    seam.realIds = true;
    seam.breakOp = null;
    return openOn(bytes);
  };
  const commitSave = async (runtime: RuntimeLike, ref: string, intentId: string) => {
    const value = runtime.snapshot(ref);
    const out = await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value }, intentId });
    await runtime.setBaseRevision!(ref, "2", intentId);
    return out.bytes;
  };

  it("rebases at a committed save so a post-save draft restored on the saved bytes never double-applies", async () => {
    const { runtime, ref } = await realOpen();
    const baseCount = liveElements(runtime, ref).length;
    const created = (await runtime.edit(ref, [box(5)])).createdIds![0]!;
    await runtime.edit(ref, [anchor(created)]);
    const saved = await commitSave(runtime, ref, "intent-1");
    // The saved prefix is gone from the journal: the snapshot is relative to the saved bytes.
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });

    // More edits after the save: a format of the element the prefix created
    // (its position was recorded on the deck that already held it) and an insert.
    await runtime.edit(ref, [anchor(liveElements(runtime, ref).at(-1)!.id, "top")]);
    await runtime.edit(ref, [box(7)]);
    const draft = runtime.snapshot(ref);
    expect(draft.revision).toBe(2);
    expect(draft.edits.map((edit) => edit.op)).toEqual(["set_text_anchor", "add_element"]);

    // Crash -> reopen the SAVED bytes (fresh ids) -> recover the draft.
    const fresh = await realOpen(saved);
    await fresh.runtime.restore!(fresh.ref, JSON.parse(JSON.stringify(draft)) as typeof draft);
    const restored = liveElements(fresh.runtime, fresh.ref);
    expect(restored).toHaveLength(baseCount + 2);
    expect(restored.at(-2)?.anchor).toBe("top");
    expect(restored.filter((element) => element.anchor !== undefined)).toHaveLength(1);
    expect(await savedShape(fresh.runtime, fresh.ref)).toBe(await savedShape(runtime, ref));

    // Undo cannot cross the save point: two tail steps, then the saved deck.
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.undo(ref)).toBe(false);
    const atSave = liveElements(runtime, ref);
    expect(atSave).toHaveLength(baseCount + 1);
    expect(atSave.at(-1)?.anchor).toBe("middle");
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });
    expect(await runtime.redo(ref)).toBe(true);
    expect(liveElements(runtime, ref).at(-1)?.anchor).toBe("top");
  });

  it("rebases onto exactly what the save serialized while typing lands around it", async () => {
    const { runtime, ref } = await realOpen();
    const baseCount = liveElements(runtime, ref).length;
    await runtime.edit(ref, [box(5)]);
    // Save N captured with one entry; typing N+1 queues BEHIND the serialize.
    const value = runtime.snapshot(ref);
    const saving = runtime.serialize(ref, { snapshot: { generation: 1, fingerprint: "fp", value }, intentId: "intent-a" });
    const typing = runtime.edit(ref, [hidden(1, true)]);
    const [out] = await Promise.all([saving, typing]);
    await runtime.setBaseRevision!(ref, "2", "intent-a");
    expect(runtime.snapshot(ref).edits.map((edit) => edit.op)).toEqual(["set_slide_hidden"]);
    const fresh = await realOpen(out.bytes);
    await fresh.runtime.restore!(fresh.ref, runtime.snapshot(ref));
    expect(liveElements(fresh.runtime, fresh.ref)).toHaveLength(baseCount + 1);
    expect(await savedShape(fresh.runtime, fresh.ref)).toBe(await savedShape(runtime, ref));

    // Typing queued AHEAD of the serialize is inside the bytes, so the rebase
    // drops it too although the Save snapshot did not carry it.
    const before = runtime.snapshot(ref);
    const ahead = runtime.edit(ref, [box(9)]);
    const second = runtime.serialize(ref, { snapshot: { generation: 3, fingerprint: "fp", value: before }, intentId: "intent-b" });
    const [, secondOut] = await Promise.all([ahead, second]);
    await runtime.setBaseRevision!(ref, "3", "intent-b");
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });
    const again = await realOpen(secondOut.bytes);
    expect(liveElements(again.runtime, again.ref)).toHaveLength(baseCount + 2);
    expect(await savedShape(again.runtime, again.ref)).toBe(await savedShape(runtime, ref));
  });

  it("holds undo at an in-flight save point, keeps a pre-save draft valid on the old base, and refuses an unknown commit", async () => {
    const { runtime, ref } = await realOpen();
    const baseCount = liveElements(runtime, ref).length;
    await expect(runtime.setBaseRevision!(ref, "2", "never-serialized")).rejects.toThrow("pptx_commit_candidate_missing");
    await runtime.edit(ref, [box(5)]);
    await runtime.edit(ref, [hidden(1, true)]);
    const preSave = runtime.snapshot(ref);
    await runtime.serialize(ref, { snapshot: { generation: 2, fingerprint: "fp", value: preSave }, intentId: "intent-1" });
    // Serialized but not committed: undo stops at the bytes the Save carries.
    expect(await runtime.undo(ref)).toBe(false);
    await runtime.edit(ref, [box(8)]);
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.undo(ref)).toBe(false);
    expect(runtime.snapshot(ref)).toEqual(preSave);
    await expect(runtime.setBaseRevision!(ref, "2", "other-intent")).rejects.toThrow("pptx_commit_candidate_missing");

    await runtime.setBaseRevision!(ref, "2", "intent-1");
    // A repeated commit report for the same intent is a no-op.
    await runtime.setBaseRevision!(ref, "2", "intent-1");
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.snapshot(ref).edits.map((edit) => edit.op)).toEqual(["add_element"]);

    // A draft taken BEFORE the save still restores onto the old base bytes.
    const old = await realOpen();
    await old.runtime.restore!(old.ref, JSON.parse(JSON.stringify(preSave)) as typeof preSave);
    expect(liveElements(old.runtime, old.ref)).toHaveLength(baseCount + 1);
    expect(isSlideHidden((await save(old.runtime, old.ref)).slides[1] ?? {})).toBe(true);
  });

  it("ends the undo hold when the save settles without committing, and keeps it while the save is in flight (W15 F2)", async () => {
    const { runtime, ref } = await realOpen();
    await runtime.edit(ref, [box(5)]);
    await runtime.edit(ref, [hidden(1, true)]);
    const value = runtime.snapshot(ref);
    await runtime.serialize(ref, { snapshot: { generation: 2, fingerprint: "fp", value }, intentId: "intent-dead" });
    // In flight (or kept for retry): undo may not cross the prefix.
    expect(await runtime.undo(ref)).toBe(false);
    // Another intent settling does not release this one's hold.
    await runtime.releaseSave!(ref, "someone-else");
    expect(await runtime.undo(ref)).toBe(false);

    // The Save settled without a commit: undo crosses the dead prefix again.
    await runtime.releaseSave!(ref, "intent-dead");
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });
    expect(await runtime.redo(ref)).toBe(true);
    // A late commit report for the released intent is loud, never a silent rebase.
    await expect(runtime.setBaseRevision!(ref, "2", "intent-dead")).rejects.toMatchObject({ code: "pptx_commit_candidate_missing" });

    // A fresh Save after the release holds and commits as before.
    const next = runtime.snapshot(ref);
    await runtime.serialize(ref, { snapshot: { generation: 3, fingerprint: "fp", value: next }, intentId: "intent-2" });
    expect(await runtime.undo(ref)).toBe(false);
    await runtime.setBaseRevision!(ref, "3", "intent-2");
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });
    // Releasing a committed or unknown intent is a harmless no-op.
    await runtime.releaseSave!(ref, "intent-2");
    await runtime.releaseSave!("missing-ref", "intent-2");
  });

  it("names a refused commit with a code the error table can read (W15 F3)", async () => {
    const { runtime, ref } = await realOpen();
    await expect(runtime.setBaseRevision!(ref, "2", "never-serialized")).rejects.toMatchObject({ code: "pptx_commit_candidate_missing" });
    // A commit for an intent that is not the pending one is refused the same way.
    await runtime.edit(ref, [box(5)]);
    const value = runtime.snapshot(ref);
    await runtime.serialize(ref, { snapshot: { generation: 1, fingerprint: "fp", value }, intentId: "intent-x" });
    await expect(runtime.setBaseRevision!(ref, "2", "intent-y")).rejects.toMatchObject({ code: "pptx_commit_candidate_missing" });
  });
}
