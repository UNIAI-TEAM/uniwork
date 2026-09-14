"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { setSchemaLogger } from "../api/schema";
import { useAuthStore } from "../auth/store";
import {
  clearRegisteredGlobalDrafts,
  resetRegisteredDraftsInMemory,
} from "../drafts/cleanup-registry";
// Ensure every module-level draft store has registered itself before the
// logout callback below can run, so the registry is never partially populated.
import "../drafts/register-all-drafts";
import { initI18n } from "../i18n";
import { createLogger } from "../logger";
import { createQueryClient } from "../query-client";
import { defaultStorage } from "./storage";

/**
 * Logout cleanup for every registered store, both layers. Memory first:
 * resetting a store writes through zustand `persist`, so clearing storage
 * before the reset would leave the emptied state behind under the same key.
 * Only global keys are removed here; workspace-scoped keys need a slug that
 * logout does not have.
 */
function clearRegisteredDraftsOnLogout(): void {
  resetRegisteredDraftsInMemory();
  clearRegisteredGlobalDrafts(defaultStorage);
}

function AuthInitializer() {
  useEffect(() => {
    void useAuthStore.getState().initialize();
  }, []);
  return null;
}

export function CoreProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [ready] = useState(() => {
    initI18n();
    setSchemaLogger(createLogger("api"));
    // Draft cleanup on logout: the Zustand singletons, which survive the
    // client-side navigation that follows logout, and the globally keyed
    // persisted storage, which survives a reload. This is the only caller of
    // `setOnLogout`; nothing calls `clearWorkspaceStorage` on logout.
    // Assigning the single callback slot is last-write-wins, so StrictMode's
    // double invocation of this initializer registers the same callback twice
    // with no additional effect.
    useAuthStore.getState().setOnLogout(clearRegisteredDraftsOnLogout);
    return true;
  });
  void ready;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer />
      {children}
    </QueryClientProvider>
  );
}
