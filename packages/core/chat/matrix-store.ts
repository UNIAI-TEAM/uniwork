"use client";

import { create } from "zustand";
import { sessionStorageAdapter } from "../platform/storage";
import type { MatrixSession } from "../types/user";
import { parseStoredMatrixSession } from "./matrix-users";

const STORAGE_KEY = "uniwork:matrix-session";

interface MatrixState {
  session: MatrixSession | null;
  setSession: (session: MatrixSession | null) => void;
}

export const useMatrixStore = create<MatrixState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
}));

function persist(session: MatrixSession | null): void {
  if (session) {
    sessionStorageAdapter.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    sessionStorageAdapter.removeItem(STORAGE_KEY);
  }
}

/** Restore Matrix credentials saved from the last login (survives page reload). */
export function restoreMatrixSession(): void {
  const session = parseStoredMatrixSession(sessionStorageAdapter.getItem(STORAGE_KEY));
  if (session) {
    useMatrixStore.getState().setSession(session);
  }
}

/** Test seam: drop module state so cases cannot leak into each other. */
export function resetMatrixStoreForTests(): void {
  sessionStorageAdapter.removeItem(STORAGE_KEY);
  useMatrixStore.setState({ session: null });
}

export function setMatrixSession(session: MatrixSession | null): void {
  useMatrixStore.getState().setSession(session);
  persist(session);
}

export function getMatrixSession(): MatrixSession | null {
  return useMatrixStore.getState().session;
}
