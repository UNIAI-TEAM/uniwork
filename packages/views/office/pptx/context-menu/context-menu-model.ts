/**
 * A7 (UNI-927) - the canvas context menu, as pure data.
 *
 * The menu lists only commands that exist and persist on this surface today.
 * Every row carries the reason it is unavailable, taken from the same facts the
 * editor already knows (a bound delete channel, a selection, the engine's own
 * `reorder_element` op). A row whose operation the engine does not implement is
 * never rendered as a working control: it is disabled with its reason, exactly
 * like a capability-gapped ribbon command.
 *
 * Pure: no React and no translation. The component maps the rows onto
 * `@uniwork/ui` context-menu items and resolves `labelKey` / `reasonKey` / vars
 * through `t()`.
 */

/** Every row the canvas menu can show, in render order. */
export type PptxContextMenuAction =
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "bring-to-front"
  | "send-to-back"
  | "edit-text"
  | "insert";

export interface PptxContextMenuContext {
  /** The current slide exists (a deck is bound and has slides). */
  slideBound: boolean;
  /** Element ids selected on the canvas. */
  selectionCount: number;
  /** A delete channel is bound (`onDeleteElements` or the handle's edit port). */
  canDelete: boolean;
  /** An edit-text channel is bound (`onTextEdit`). */
  canEditText: boolean;
  /** The insert surface is mounted on this editor (no Insert panel yet -> false). */
  canInsert: boolean;
  /** The z-order op (`reorder_element`) is reachable through the edit channel. */
  canReorder: boolean;
  /** The editor is applying a gesture; every mutating row waits. */
  gesturePending: boolean;
  /** A document read-only / capability gate refuses edits. */
  readonly: boolean;
}

export interface PptxContextMenuRow {
  action: PptxContextMenuAction;
  /** i18next key under office.pptx.context_menu. */
  labelKey: string;
  /** i18next key under office.pptx.context_menu explaining a disabled row. */
  reasonKey?: string;
  /** `{{vars}}` for labelKey (e.g. the selection count). */
  labelVars?: Record<string, string>;
  enabled: boolean;
  /** Starts a new group in the menu. */
  separatorBefore?: boolean;
  destructive?: boolean;
  /** A quick key hint shown at the right of the row. */
  shortcut?: string;
}

const OFF: PptxContextMenuContext = {
  slideBound: false,
  selectionCount: 0,
  canDelete: false,
  canEditText: false,
  canInsert: false,
  canReorder: false,
  gesturePending: false,
  readonly: false,
};

/** Why an element command cannot run, or null when it can. */
function elementBlocked(context: PptxContextMenuContext): string | null {
  if (context.readonly) return "reason_readonly";
  if (!context.slideBound) return "reason_no_slide";
  if (context.gesturePending) return "reason_pending";
  if (context.selectionCount === 0) return "reason_no_selection";
  return null;
}

function row(
  action: PptxContextMenuAction,
  labelKey: string,
  enabled: boolean,
  extras: Partial<PptxContextMenuRow> = {},
): PptxContextMenuRow {
  return { action, labelKey, enabled, ...(enabled ? {} : { reasonKey: "reason_unavailable" }), ...extras };
}

/**
 * Build the rows for the current editor facts. A disabled row always names why:
 * an unbound operation, an empty selection, a pending gesture, a read-only deck,
 * or the clipboard ops the engine does not implement yet.
 */
export function buildPptxContextMenu(input: Partial<PptxContextMenuContext> = {}): PptxContextMenuRow[] {
  const context: PptxContextMenuContext = { ...OFF, ...input };
  const blocked = elementBlocked(context);
  const hasSelection = context.selectionCount > 0;

  // The clipboard rows are honest about the engine: there is no copy/cut/paste
  // op in the PPTX edit union today, so they are disabled with that reason.
  const clipboard = (action: "cut" | "copy" | "paste", labelKey: string, shortcut: string): PptxContextMenuRow =>
    row(action, labelKey, false, { shortcut, reasonKey: "reason_clipboard_unbound" });

  const rows: PptxContextMenuRow[] = [
    clipboard("cut", "cut", "Ctrl+X"),
    clipboard("copy", "copy", "Ctrl+C"),
    clipboard("paste", "paste", "Ctrl+V"),
    row("delete", "delete", hasSelection && context.canDelete && !blocked, {
      separatorBefore: true,
      destructive: true,
      shortcut: "Delete",
      ...(hasSelection && context.canDelete && !blocked ? {} : { reasonKey: blocked ?? "reason_delete_unbound" }),
    }),
    row("bring-to-front", "bring_to_front", hasSelection && context.canReorder && !blocked, {
      separatorBefore: true,
      ...(hasSelection && context.canReorder && !blocked ? {} : { reasonKey: blocked ?? "reason_reorder_unbound" }),
    }),
    row("send-to-back", "send_to_back", hasSelection && context.canReorder && !blocked, {
      ...(hasSelection && context.canReorder && !blocked ? {} : { reasonKey: blocked ?? "reason_reorder_unbound" }),
    }),
    row("edit-text", "edit_text", hasSelection && context.canEditText && !blocked, {
      separatorBefore: true,
      shortcut: "F2",
      ...(hasSelection && context.canEditText && !blocked ? {} : { reasonKey: blocked ?? "reason_edit_text_unbound" }),
    }),
    row("insert", "insert", context.canInsert && context.slideBound && !context.readonly && !context.gesturePending, {
      separatorBefore: true,
      ...(context.canInsert && context.slideBound && !context.readonly && !context.gesturePending
        ? {}
        : { reasonKey: !context.canInsert ? "reason_insert_unbound" : (blocked ?? "reason_insert_unbound") }),
    }),
  ];
  return rows;
}

/** Only the rows that can run, for a caller that renders a trimmed menu. */
export function enabledPptxContextMenuActions(rows: readonly PptxContextMenuRow[]): PptxContextMenuAction[] {
  return rows.filter((entry) => entry.enabled).map((entry) => entry.action);
}