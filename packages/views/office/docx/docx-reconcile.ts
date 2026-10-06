// Turns a DesiredItem[] (docx-doc-convert.ts) into the G2 engine's own
// DocxEdit ops, applied through DocxAdapter.edit — never a second plan/engine.
// Runs exactly once per save (use-docx-tiptap-handle.ts's captureSnapshot),
// against the model's current pristine baseline (the adapter session's plan
// right after open/rebase, before this save's edits are applied), so a
// mid-typing keystroke never has to resolve against a half-applied plan.
// No block reordering is supported: the desired list's original-derived
// items are expected to keep pristine relative order (move-block editing is
// out of scope for this slice, same as table/image editing).
//
// Two cursors track the walk: `pristinePtr` is a position in the untouched
// pristineDocxIndexes array (used only to find/skip originals), `planIndex`
// is a position in the adapter's live, mutating plan (used for every
// insert_generated index — removals shrink the plan but never move
// planIndex, since the next entry slides into the gap).
import type { DocxAdapter } from "@uniwork/office-engine/docx";
import type { DesiredItem } from "./docx-doc-convert";

/** Only the one call this module makes — easy to fake in a test without a
 * real engine binding, and a narrower dependency than the whole adapter. */
export type DocxEditPort = Pick<DocxAdapter, "edit">;

export function reconcileDocxPlan(adapter: DocxEditPort, ref: string, pristineDocxIndexes: readonly number[], desired: readonly DesiredItem[]): void {
  let pristinePtr = 0;
  let planIndex = 0;
  const removeThrough = (targetPristineIdx: number) => {
    while (pristinePtr < targetPristineIdx) {
      const docxIndex = pristineDocxIndexes[pristinePtr];
      if (docxIndex === undefined) break;
      adapter.edit(ref, { op: "remove_block", docxIndex });
      pristinePtr += 1;
    }
  };

  for (const item of desired) {
    if (item.kind === "insert") {
      adapter.edit(ref, { op: "insert_generated", index: planIndex, block: item.block });
      planIndex += 1;
      continue;
    }
    const pristineAt = pristineDocxIndexes.indexOf(item.docxIndex, pristinePtr);
    if (pristineAt < 0) continue; // defensive: every docxIndex here came from this same pristine snapshot
    removeThrough(pristineAt);
    if (item.kind === "passthrough") {
      planIndex += 1;
      pristinePtr += 1;
      continue;
    }
    if (item.kind === "text-edit") {
      adapter.edit(ref, { op: "set_paragraph_text", docxIndex: item.docxIndex, runs: item.runs });
      planIndex += 1;
      pristinePtr += 1;
      continue;
    }
    // "restyle": the engine never retypes an existing block in place
    // (model.ts requireParagraphTarget) — remove the original, insert the
    // replacement at the gap it leaves.
    adapter.edit(ref, { op: "remove_block", docxIndex: item.docxIndex });
    pristinePtr += 1;
    adapter.edit(ref, { op: "insert_generated", index: planIndex, block: item.block });
    planIndex += 1;
  }
  removeThrough(pristineDocxIndexes.length);
}
