"use client";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { actionItemTaskDefaults } from "@uniwork/core/meetings/summary-task-items";
import type { TaskPriority } from "@uniwork/core/types";

/** What the clerk changed on a pending row before assigning; held on the client only. */
export type ItemOverride = { assignee_id?: string | null; due_date?: string | null; priority?: TaskPriority };

export type EffectiveValues = {
  assignee_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  /** The due date is still the server's guess from a loose phrase ("thứ Hai"). */
  guessed: boolean;
};

/** A pending row's values as the review sheet will send them: the clerk's change, else the suggestion. */
export function effectiveValues(item: MeetingActionItem, override: ItemOverride | undefined): EffectiveValues {
  const due = override && "due_date" in override ? (override.due_date ?? null) : (item.suggested_due_date ?? null);
  return {
    assignee_id:
      override && "assignee_id" in override ? (override.assignee_id ?? null) : (item.suggested_assignee_id ?? null),
    due_date: due,
    priority: override?.priority ?? actionItemTaskDefaults(item, undefined).priority ?? "none",
    guessed: Boolean(due) && item.suggested_due_guessed === true && !(override && "due_date" in override),
  };
}

export type ListKeyAction = "next" | "prev" | "review" | null;

/**
 * What a key does inside the item list (brief: ↑/↓ move, ⌘/Ctrl+Enter
 * reviews; Space is the checkbox's own). Nothing while an IME is composing
 * (Telex/VNI) or while typing in a field or a combobox.
 */
export function listKeyAction(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  keyCode?: number;
  isComposing?: boolean;
  target: EventTarget | null;
}): ListKeyAction {
  if (event.isComposing || event.keyCode === 229) return null;
  const el = event.target instanceof Element ? event.target : null;
  if (el?.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox']")) return null;
  if (event.key === "ArrowDown") return "next";
  if (event.key === "ArrowUp") return "prev";
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) return "review";
  return null;
}

const NONE: ReadonlySet<string> = new Set();
/** How long Hoàn tác stays on the dock after an assignment (spec G); the server takes back two minutes at most. */
export const UNDO_MS = 8_000;
/** The longest a held (hovered, focused) Hoàn tác lasts: the server's two minutes, less a margin for the round trip. */
const UNDO_CAP_MS = 115_000;

/**
 * The last assignment, held for Hoàn tác: `at` is when it landed, `end` the
 * wall-clock deadline, pushed back by however long it was held (`heldAt`).
 */
export type Assigned = { ids: readonly string[]; at: number; end: number; heldAt: number | null };

/** Hoàn tác still holds at `now`: inside the server's window, and before its deadline unless held. */
const undoOpen = (a: Assigned, now: number) => now - a.at < UNDO_CAP_MS && (a.heldAt !== null || now < a.end);

/**
 * Selection and per-row edits of the close-out board (brief §2 "Selection
 * bar"): ticks are item ids, kept only while the item is still pending, so a
 * row assigned or dismissed elsewhere drops out of the selection.
 */
export function useCloseOut(items: readonly MeetingActionItem[]) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(NONE);
  const [overrides, setOverrides] = useState<Record<string, ItemOverride>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  // The ids the last assignment turned into tasks, held for Hoàn tác; a new one restarts the countdown.
  const [assigned, setAssigned] = useState<Assigned | null>(null);

  // The wall clock, read often: a timer stalls through a system sleep, the server's window does not.
  useEffect(() => {
    if (!assigned) return;
    const id = setInterval(() => {
      if (!undoOpen(assigned, Date.now())) setAssigned(null);
    }, 250);
    return () => clearInterval(id);
  }, [assigned]);
  const markAssigned = useCallback((ids: readonly string[]) => {
    const now = Date.now();
    setAssigned({ ids, at: now, end: now + UNDO_MS, heldAt: null });
  }, []);
  const clearAssigned = useCallback(() => setAssigned(null), []);
  /** Pauses the countdown while the dock is hovered or holds focus; letting go pushes the deadline back by the pause. */
  const holdUndo = useCallback((hold: boolean) => {
    setAssigned((a) => {
      if (!a || hold === (a.heldAt !== null)) return a;
      const now = Date.now();
      return a.heldAt === null ? { ...a, heldAt: now } : { ...a, end: a.end + now - a.heldAt, heldAt: null };
    });
  }, []);
  /** The ids Hoàn tác may still take back, read on the wall clock at the click; null, and the dock leaves, once it is over. */
  const undoIds = useCallback((): readonly string[] | null => {
    if (assigned && undoOpen(assigned, Date.now())) return assigned.ids;
    setAssigned(null);
    return null;
  }, [assigned]);

  const pending = useMemo(() => items.filter((item) => item.status === "PENDING"), [items]);
  const picked = useMemo(() => pending.filter((item) => ticked.has(item.id)), [pending, ticked]);

  // Stale ticks are pruned, so an item restored later never comes back ticked.
  useEffect(() => {
    if (ticked.size === picked.length) return;
    setTicked(new Set(picked.map((item) => item.id)));
  }, [picked, ticked]);

  const setMany = useCallback((ids: readonly string[], on: boolean) => {
    setTicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const setOverride = useCallback((id: string, patch: ItemOverride) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  /** onKeyDown of the list: arrows walk the rows' checkboxes, ⌘/Ctrl+Enter opens the review. */
  const onListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const action = listKeyAction({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        keyCode: event.keyCode,
        isComposing: event.nativeEvent.isComposing,
        target: event.target,
      });
      if (!action) return;
      event.preventDefault();
      if (action === "review") {
        if (picked.length > 0) setReviewOpen(true);
        return;
      }
      const boxes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-close-out-row] [role='checkbox']"));
      const row = (event.target as Element).closest("[data-close-out-row]");
      const at = boxes.findIndex((box) => box.closest("[data-close-out-row]") === row);
      const next = boxes[action === "next" ? Math.min(at + 1, boxes.length - 1) : Math.max(at - 1, 0)];
      next?.focus();
    },
    [picked.length],
  );

  return {
    picked,
    isTicked: (id: string) => ticked.has(id),
    toggle: (id: string, on: boolean) => setMany([id], on),
    setMany,
    clear: () => setTicked(NONE),
    overrides,
    setOverride,
    valuesOf: (item: MeetingActionItem) => effectiveValues(item, overrides[item.id]),
    reviewOpen,
    setReviewOpen,
    onListKeyDown,
    assigned,
    markAssigned,
    clearAssigned,
    holdUndo,
    undoIds,
  };
}

export type CloseOut = ReturnType<typeof useCloseOut>;
