"use client";
import { useCallback, useMemo, useState } from "react";
import { draftChanges, type MeetingDraft } from "./draft-model";

/**
 * The sheet's draft state: the values, the snapshot they started from (open,
 * prefill or a reload), which fields were left after a change (errors show
 * from then on) and whether a submit was tried (every error shows).
 */
export function useMeetingDraft(initial: MeetingDraft) {
  const [state, setState] = useState(() => ({ draft: initial, snapshot: initial }));
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);

  const patch = useCallback((next: Partial<MeetingDraft>) => setState((s) => ({ ...s, draft: { ...s.draft, ...next } })), []);
  const reset = useCallback((next: MeetingDraft) => {
    setState({ draft: next, snapshot: next });
    setTouched(new Set());
    setSubmitted(false);
  }, []);
  const touch = useCallback((field: string) => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field))), []);
  const changes = useMemo(() => draftChanges(state.draft, state.snapshot), [state]);

  return { draft: state.draft, snapshot: state.snapshot, patch, reset, touched, touch, submitted, setSubmitted, changes };
}

export type MeetingDraftState = ReturnType<typeof useMeetingDraft>;
