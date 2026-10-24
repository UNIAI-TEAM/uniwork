"use client";

import { useEffect, useRef, useState } from "react";
import { findUnreadable, type UnreadableCandidate } from "@uniwork/core/documents/folder-upload";

/** A probe still running after this long opens the dialog in its checking state. */
const CHECKING_AFTER_MS = 400;

export interface UnreadableCheck {
  /** The dialog may open: the probe settled, or ran past the threshold. */
  ready: boolean;
  /** Open, and the probe is still running. */
  checking: boolean;
  /** Planned paths of the files the browser cannot read; empty until the probe settles. */
  unreadable: string[];
}

const NONE: string[] = [];

/**
 * Probes the files a staged pick would send, before the dialog opens (UNI-2152).
 * Only size-0 files are read, so a pick with none is ready on the same render,
 * with no flash. A quick probe opens the dialog already holding its answer; one
 * past 400 ms opens it in the checking state. `stage` identifies the pick: a new
 * one starts over and the old probe is cancelled, as it is when the stage goes
 * (Hủy, Esc) or the page unmounts.
 */
export function useUnreadableCheck(stage: object | null, candidates: readonly UnreadableCandidate[]): UnreadableCheck {
  const [answer, setAnswer] = useState<{ stage: object; unreadable: string[] } | null>(null);
  const [slow, setSlow] = useState<object | null>(null);
  const latest = useRef(candidates);
  latest.current = candidates;
  const needsProbe = candidates.some((candidate) => candidate.file.size === 0);

  useEffect(() => {
    if (!stage || !needsProbe) return;
    const controller = new AbortController();
    const timer = setTimeout(() => setSlow(stage), CHECKING_AFTER_MS);
    findUnreadable(latest.current, { signal: controller.signal }).then(
      (unreadable) => setAnswer({ stage, unreadable }),
      // Anything but a cancel: the probe could not tell, so the run goes ahead as it would have without it.
      () => {
        if (!controller.signal.aborted) setAnswer({ stage, unreadable: NONE });
      },
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [stage, needsProbe]);

  if (!stage) return { ready: false, checking: false, unreadable: NONE };
  if (!needsProbe) return { ready: true, checking: false, unreadable: NONE };
  if (answer?.stage === stage) return { ready: true, checking: false, unreadable: answer.unreadable };
  return { ready: slow === stage, checking: slow === stage, unreadable: NONE };
}
