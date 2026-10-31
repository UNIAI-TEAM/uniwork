"use client";

import { create } from "zustand";

type OfficeHandoffStatus = "pending" | "sent" | "running" | "idle" | "refused";

interface OfficeHandoffEntry {
  handoffId: string;
  /** The first question the editor AI is sent: it is the job Ask UNI handed over, worded for the editor. */
  text: string;
  status: OfficeHandoffStatus;
}

interface OfficeHandoffStore {
  /** By the new document's id. In memory only: a reload loses the id, the document still opens. */
  byDocument: Record<string, OfficeHandoffEntry>;
  queue: (documentId: string, handoffId: string, text: string) => void;
  /** Hands the entry to the editor once: only a "pending" one, which then reads as "sent". */
  take: (documentId: string) => OfficeHandoffEntry | null;
  /** No-op for a document with no entry, so a stray frame message never invents one. */
  setStatus: (documentId: string, status: OfficeHandoffStatus) => void;
  /** Logout: the next person on this browser inherits no job. */
  reset: () => void;
}

export const useOfficeHandoffStore = create<OfficeHandoffStore>()((set, get) => ({
  byDocument: {},
  queue: (documentId, handoffId, text) =>
    set((s) => ({ byDocument: { ...s.byDocument, [documentId]: { handoffId, text, status: "pending" } } })),
  take: (documentId) => {
    const entry = get().byDocument[documentId];
    if (!entry || entry.status !== "pending") return null;
    set((s) => ({ byDocument: { ...s.byDocument, [documentId]: { ...entry, status: "sent" } } }));
    return entry;
  },
  setStatus: (documentId, status) =>
    set((s) => {
      const entry = s.byDocument[documentId];
      return entry ? { byDocument: { ...s.byDocument, [documentId]: { ...entry, status } } } : s;
    }),
  reset: () => set({ byDocument: {} }),
}));
