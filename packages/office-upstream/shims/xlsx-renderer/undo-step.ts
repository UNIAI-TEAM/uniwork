import { IUndoRedoService, type Injector } from "@univerjs/core";

/** One command of a batch: the same id/params pair `executeCommand` takes. */
export interface XlsxRendererCommandStep {
  id: string;
  params?: unknown;
}

/** UNI-953: runs commands so Univer records them as ONE undo entry (a rich
 *  paste writes values, formats and merges with separate commands, and one
 *  Ctrl+Z must take all of it back). Univer folds every undo push for the
 *  unit into the first while the batch is open. Stops at the first refusal
 *  and answers how many steps ran (steps.length: all of them); what already
 *  ran stays in the same single entry, so one undo still restores the range.
 *  0 means nothing was written (a refusal at the first step, a batch already
 *  open, no unit): a caller may then redo the work another way, but after a
 *  partial run (0 < n < steps.length) it must not write the same cells again. */
export async function executeAsOneUndoStep(
  injector: Pick<Injector, "get">,
  unitId: string,
  steps: readonly XlsxRendererCommandStep[],
  execute: (step: XlsxRendererCommandStep) => Promise<boolean>,
): Promise<number> {
  if (steps.length === 0) return 0;
  let batch: { dispose(): void };
  try {
    batch = injector.get(IUndoRedoService).__tempBatchingUndoRedo(unitId);
  } catch {
    // Another batch is open on this unit (Univer refuses nesting).
    return 0;
  }
  try {
    let completed = 0;
    for (const step of steps) {
      if (!(await execute(step))) break;
      completed += 1;
    }
    return completed;
  } finally {
    batch.dispose();
  }
}
