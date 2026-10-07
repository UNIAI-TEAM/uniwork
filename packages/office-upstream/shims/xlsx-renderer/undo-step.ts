import { IUndoRedoService, type IUndoRedoItem, type Injector } from "@univerjs/core";

/** One command of a batch: the same id/params pair `executeCommand` takes. */
export interface XlsxRendererCommandStep {
  id: string;
  params?: unknown;
}

/** Options of a batch. `rollback`: a refusal after some steps ran takes
 *  them back (the batched undo entry is removed and its undo mutations run),
 *  so the batch is all or nothing; used where a half-applied run would leave
 *  a wrong model (a DV rule edit, review dvcf F1). Off by default: a paste
 *  keeps what ran. */
export interface XlsxRendererBatchOptions {
  rollback?: boolean;
}

const ROLLBACK_ID = "uniwork-batch-rollback";

/** UNI-953: runs commands so Univer records them as ONE undo entry (a rich
 *  paste writes values, formats and merges with separate commands, and one
 *  Ctrl+Z must take all of it back). Univer folds every undo push for the
 *  unit into the first while the batch is open. Stops at the first refusal
 *  and answers how many steps ran (steps.length: all of them); what already
 *  ran stays in the same single entry, so one undo still restores the range.
 *  0 means nothing was written (a refusal at the first step, a batch already
 *  open, no unit): a caller may then redo the work another way, but after a
 *  partial run (0 < n < steps.length) it must not write the same cells again.
 *  With `rollback` a partial run is taken back and answers 0: a step that
 *  throws counts as a refusal, and the redo history the batch's first push
 *  cleared comes back (review-delta D1, D5); without it a throw propagates. */
export async function executeAsOneUndoStep(
  injector: Pick<Injector, "get">,
  unitId: string,
  steps: readonly XlsxRendererCommandStep[],
  execute: (step: XlsxRendererCommandStep) => Promise<boolean>,
  options: XlsxRendererBatchOptions = {},
): Promise<number> {
  if (steps.length === 0) return 0;
  let batch: { dispose(): void };
  let service: IUndoRedoService;
  let before: IUndoRedoItem | null;
  try {
    service = injector.get(IUndoRedoService);
    before = topUndoItem(service, unitId);
    batch = service.__tempBatchingUndoRedo(unitId);
  } catch {
    // Another batch is open on this unit (Univer refuses nesting).
    return 0;
  }
  const redoBefore = redoStack(service, unitId)?.slice() ?? null;
  let completed = 0;
  // Where each undo push ends inside the batched entry: one group per push,
  // so a command pushing several items also undoes newest first (D3).
  const groupEnds: number[] = [];
  const markGroupEnd = () => {
    const top = topUndoItem(service, unitId);
    if (top && top !== before) groupEnds.push(top.undoMutations.length);
  };
  const restorePush = markEveryPush(service, unitId, markGroupEnd);
  let batched: IUndoRedoItem | null = null;
  let thrown: { error: unknown } | null = null;
  try {
    for (const step of steps) {
      const ran = await execute(step);
      markGroupEnd();
      if (!ran) break;
      completed += 1;
    }
  } catch (error) {
    thrown = { error };
  } finally {
    restorePush();
    batch.dispose();
    const top = topUndoItem(service, unitId);
    if (top && top !== before) {
      batched = top;
      undoNewestFirst(top, groupEnds);
    }
  }
  if (!options.rollback) {
    if (thrown) throw thrown.error;
    return completed;
  }
  if (completed === steps.length) return completed;
  // The first undo push of the batch appended a new entry and the rest
  // folded into it, so the new top for this unit is exactly what ran.
  if (batched) {
    batched.id = ROLLBACK_ID;
    service.rollback(ROLLBACK_ID, unitId);
    const redo = redoStack(service, unitId);
    if (redo && redoBefore) redo.splice(0, redo.length, ...redoBefore);
    (service as unknown as { _updateStatus?: () => void })._updateStatus?.();
  }
  return 0;
}

/** Calls `mark` after every undo push for `unitId` while the batch is open;
 *  answers the function that puts the service's own push back. */
function markEveryPush(service: IUndoRedoService, unitId: string, mark: () => void): () => void {
  const target = service as unknown as Record<string, unknown>;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, "pushUndoRedo");
  const own = target.pushUndoRedo;
  const push = service.pushUndoRedo;
  if (typeof push !== "function") return () => {};
  target.pushUndoRedo = function (this: unknown, item: IUndoRedoItem) {
    push.call(this ?? service, item);
    if (item.unitID === unitId) mark();
  };
  return () => {
    if (hadOwn) target.pushUndoRedo = own;
    else delete target.pushUndoRedo;
  };
}

/** The unit's redo stack on the pinned LocalUndoRedoService (null on a port
 *  without one): its pushUndoRedo empties it in place. */
function redoStack(service: IUndoRedoService, unitId: string): IUndoRedoItem[] | null {
  const local = service as unknown as { _redoStacks?: Map<string, IUndoRedoItem[]> };
  return local._redoStacks?.get(unitId) ?? null;
}

/** The unit's newest undo entry. The pinned LocalUndoRedoService keeps one
 *  stack per unit; the public peek reads the focused unit only. */
function topUndoItem(service: IUndoRedoService, unitId: string): IUndoRedoItem | null {
  const local = service as unknown as { _pitchUndoElement?: (unitId: string) => IUndoRedoItem | null };
  if (typeof local._pitchUndoElement === "function") return local._pitchUndoElement(unitId) ?? null;
  const top = service.pitchTopUndoElement?.() ?? null;
  return top && top.unitID === unitId ? top : null;
}

/** Univer folds a batched push by appending its undo mutations after the
 *  earlier ones, so one undo would replay the OLDEST step's undo first: a
 *  bottom-up run of row inserts then removes the wrong rows and deletes data.
 *  Undo must take the steps back newest first; each step's own group keeps
 *  its order, and redo stays in run order. */
function undoNewestFirst(item: IUndoRedoItem, groupEnds: readonly number[]): void {
  const groups: IUndoRedoItem["undoMutations"][] = [];
  let from = 0;
  for (const end of groupEnds) {
    if (end > from) groups.push(item.undoMutations.slice(from, end));
    from = Math.max(from, end);
  }
  if (from < item.undoMutations.length) groups.push(item.undoMutations.slice(from));
  item.undoMutations = groups.reverse().flat();
}
