// The composer's side of the drafts (data/stores/draft-store.ts): its text
// read once when it mounts and written back as the person types, 400 ms after
// the last keystroke (a keystroke must not redraw the inbox underneath), right
// away when the composer goes or the app leaves the front (a kill after that
// keeps it), and cleared by a send. And the inbox's side: each room's draft
// as one line for its row.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { readDraft, useDraftStore } from "@/data/stores/draft-store";
import { roomDraftLines, type DraftReply } from "@/lib/drafts";

export const DRAFT_SAVE_MS = 400;

export interface DraftPersistence {
  initialText: string;
  initialReply: DraftReply | undefined;
  /** The text as typed: written after a pause. */
  save: (text: string) => void;
  /** Write what is waiting now (before an edit borrows the field). */
  flush: () => void;
  /** The text kept for this composer (after an edit gives the field back). */
  savedText: () => string;
  /** Sent: the draft is gone. */
  clear: () => void;
}

/** A composer's draft; without a key nothing is kept. */
export function useDraftPersistence(key: string | undefined): DraftPersistence {
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initial = useMemo(() => (key ? readDraft(key) : undefined), [key]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (key && pending.current !== null) useDraftStore.getState().setText(key, pending.current);
    pending.current = null;
  }, [key]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  const save = useCallback(
    (text: string) => {
      if (!key) return;
      pending.current = text;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DRAFT_SAVE_MS);
    },
    [key, flush],
  );
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    if (key) useDraftStore.getState().clear(key);
  }, [key]);
  const savedText = useCallback(() => (key ? (readDraft(key)?.text ?? "") : ""), [key]);

  return { initialText: initial?.text ?? "", initialReply: initial?.reply, save, flush, savedText, clear };
}

/** Room id → its draft as one line, for this person's workspace (the inbox's "Nháp: …"); the same object while no line changed. */
export function useRoomDraftLines(wsId: string, userId: string): Record<string, string> {
  return useDraftStore(useShallow((state) => roomDraftLines(state.drafts, userId, wsId)));
}
