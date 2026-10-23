"use client";

import { createContext, useContext } from "react";

/**
 * The document page's edit lock as an Office frame sees it (UNI-1645,
 * addendum §11.1). The page acquires and heartbeats the lock (bearer R2,
 * never the frame token); the frame host only reads it: not holding it is
 * view-only, the held id rides on the frame's commit, and a 423 on a frame
 * Save is handed back so the page ends its hold like any lost lock.
 * No provider (a frame outside the document page) = no lock management.
 */
export interface FrameEditLock {
  /** This page's editor holds the lock; anything else (acquiring, someone else, lost) is read-only. */
  held: boolean;
  /** The held tenure, sent as `edit_lock_id` on the frame's commit. */
  lockId: string | undefined;
  /** A frame Save answered 423 document_locked; `fields` is the 423 body's holder. */
  onLocked: (fields: Record<string, unknown> | undefined) => void;
}

export const FrameEditLockContext = createContext<FrameEditLock | null>(null);

export function useFrameEditLock(): FrameEditLock | null {
  return useContext(FrameEditLockContext);
}
