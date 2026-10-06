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
 *  and answers false; what already ran stays in the same single entry, so
 *  one undo still restores the range. */
export async function executeAsOneUndoStep(
  injector: Pick<Injector, "get">,
  unitId: string,
  steps: readonly XlsxRendererCommandStep[],
  execute: (step: XlsxRendererCommandStep) => Promise<boolean>,
): Promise<boolean> {
  if (steps.length === 0) return true;
  let batch: { dispose(): void };
  try {
    batch = injector.get(IUndoRedoService).__tempBatchingUndoRedo(unitId);
  } catch {
    // Another batch is open on this unit (Univer refuses nesting).
    return false;
  }
  try {
    for (const step of steps) {
      if (!(await execute(step))) return false;
    }
    return true;
  } finally {
    batch.dispose();
  }
}
