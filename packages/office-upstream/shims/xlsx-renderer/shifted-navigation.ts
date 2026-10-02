import { Direction } from "@univerjs/core";
import type { LazyWorkbookState, UniverRuntime } from "../../upstream/apps/sheets/src/renderer/univer-state";
import { canEditRange } from "./command-policy";

/** The pinned inline editor registers only unmodified Enter/Tab. Capture
 * these two missing keys at the mounted grid, never at window/document. */
export function installShiftedNavigation(
  container: HTMLElement,
  runtime: UniverRuntime,
  ports: { getState(): LazyWorkbookState | null; readOnly: boolean; commitEdit(): Promise<void>; onFailure(): void },
): () => void {
  let disposed = false;
  let composing = false;
  let pending = false;
  let pendingTarget: HTMLElement | null = null;
  let interaction = 0;
  const pointerdown = () => { interaction += 1; };
  const compositionStart = () => { composing = true; interaction += 1; };
  const compositionEnd = () => { composing = false; };
  const keydown = (event: KeyboardEvent) => {
    if (pending && (!event.shiftKey || !["Tab", "Enter"].includes(event.key))) interaction += 1;
    if (disposed || ports.readOnly || composing || event.isComposing || event.keyCode === 229 ||
      !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !["Tab", "Enter"].includes(event.key)) return;
    const target = event.target as HTMLElement | null;
    if (!target || target !== container.ownerDocument.activeElement || !container.contains(target) ||
      !target.isContentEditable || target.id !== "__editor___INTERNAL_EDITOR__DOCS_NORMAL" ||
      target.getAttribute("data-u-comp") !== "editor") return;
    if (pending && target === pendingTarget) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const state = ports.getState();
    const workbook = runtime.univerAPI.getActiveWorkbook();
    const sheet = workbook?.getActiveSheet();
    const range = workbook?.getActiveRange();
    if (!state || !workbook || !sheet || !range || !workbook.isCellEditing() ||
      !canEditRange(state, sheet.getSheetId(), range.getRange())) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pending || event.repeat) return;
    pending = true;
    pendingTarget = target;
    const key = event.key;
    const capturedInteraction = interaction;
    void (async () => {
      await ports.commitEdit();
      if (disposed || capturedInteraction !== interaction || ports.getState() !== state || runtime.univerAPI.getActiveWorkbook()?.getId() !== workbook.getId() ||
        workbook.getActiveSheet()?.getSheetId() !== sheet.getSheetId() || !container.contains(container.ownerDocument.activeElement)) return;
      // endEditingAsync(true) uses plain Enter and may move down. Restore its
      // captured selection before invoking the existing reverse command.
      workbook.setActiveRange(range);
      // Pinned enter-tab indexes the preceding selection at -1 when there
      // is only one selection, clearing its primary. The existing directional
      // move command retains the primary and handles merges/worksheet edges.
      await runtime.univerAPI.executeCommand("sheet.command.move-selection", {
        direction: key === "Tab" ? Direction.LEFT : Direction.UP,
      });
      if (!disposed && ports.getState() === state && container.contains(container.ownerDocument.activeElement)) {
        target.focus({ preventScroll: true });
      }
    })().catch(() => { if (!disposed && ports.getState() === state) ports.onFailure(); })
      .finally(() => { pending = false; pendingTarget = null; });
  };
  container.addEventListener("compositionstart", compositionStart, true);
  container.addEventListener("compositionend", compositionEnd, true);
  container.addEventListener("keydown", keydown, true);
  container.addEventListener("pointerdown", pointerdown, true);
  return () => {
    disposed = true;
    container.removeEventListener("compositionstart", compositionStart, true);
    container.removeEventListener("compositionend", compositionEnd, true);
    container.removeEventListener("keydown", keydown, true);
    container.removeEventListener("pointerdown", pointerdown, true);
  };
}
