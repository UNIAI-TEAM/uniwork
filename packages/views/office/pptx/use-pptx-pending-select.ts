"use client";

/**
 * Select-after-insert (UNI-927 W9, hardened in W10a for W9 review F1).
 *
 * `select()` only takes ids present in the CURRENT boxes, so the ids an edit minted
 * wait until the rendition that carries them mounts. Element ids repeat across slides,
 * so the wait is scoped: it is keyed to the slide and the deck revision it was
 * requested on, and it is dropped - never fired later - when
 *  - the user changes slide or makes another selection meanwhile,
 *  - a rendition for a newer revision mounts without the ids (that is the edit's own
 *    rendition, or a newer edit already landed),
 *  - or a short timeout passes (a host whose revision never moves).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PptxNodeBox } from "./canvas/render-tree";

const PENDING_SELECT_TIMEOUT_MS = 2000;

interface PptxPendingSelectInput {
  slideIndex: number;
  /** The deck revision the canvas renders; undefined leaves only the timeout. */
  revision: string | number | undefined;
  boxes: readonly PptxNodeBox[];
  /** True once `boxes` come from a mounted rendition (not while one is building). */
  ready: boolean;
  selectedIds: readonly string[];
  select: (ids: readonly string[]) => void;
  timeoutMs?: number;
}

interface PendingSelect {
  ids: readonly string[];
  slideIndex: number;
  revision: string | number | undefined;
  selection: readonly string[];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** The slide and selection an edit was REQUESTED on (W11b, W10 review F3). */
export interface PptxCreatedBaseline {
  slideIndex: number;
  selectedIds: readonly string[];
}

/**
 * Returns the `onCreated` callback an edit channel reports minted ids to. The channel
 * stamps `requestedAt` when it SENDS the edit, so a slide or selection change made while
 * the edit is in flight differs from the baseline and drops the wait; without a stamp the
 * baseline is the state at resolution.
 */
export function usePptxPendingSelect({ slideIndex, revision, boxes, ready, selectedIds, select, timeoutMs = PENDING_SELECT_TIMEOUT_MS }: PptxPendingSelectInput) {
  const [pending, setPending] = useState<PendingSelect | null>(null);
  const latest = useRef({ slideIndex, revision, selectedIds });
  useEffect(() => { latest.current = { slideIndex, revision, selectedIds }; }, [revision, selectedIds, slideIndex]);

  const onCreated = useCallback((ids: readonly string[], requestedAt?: PptxCreatedBaseline) => {
    const { slideIndex: at, revision: rev, selectedIds: selection } = latest.current;
    setPending({ ids, slideIndex: requestedAt?.slideIndex ?? at, revision: rev, selection: requestedAt?.selectedIds ?? selection });
  }, []);

  useEffect(() => {
    if (!pending) return;
    if (slideIndex !== pending.slideIndex || !sameIds(selectedIds, pending.selection)) {
      setPending(null);
      return;
    }
    if (pending.ids.some((id) => boxes.some((entry) => entry.sourceId === id))) {
      setPending(null);
      select(pending.ids);
      return;
    }
    if (ready && revision !== pending.revision) setPending(null);
  }, [boxes, pending, ready, revision, select, selectedIds, slideIndex]);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), timeoutMs);
    return () => clearTimeout(timer);
  }, [pending, timeoutMs]);

  return onCreated;
}
