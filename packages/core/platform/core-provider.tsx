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
import { QuerySessionSync } from "./query-session-sync";
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
  // Persist may rewrite the emptied state on the next microtask after reset.
  queueMicrotask(() => clearRegisteredGlobalDrafts(defaultStorage));
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
    return true;
  });
  void ready;

  useEffect(() => {
    // Draft cleanup on logout: the Zustand singletons, which survive the
    // client-side navigation that follows logout, and the globally keyed
    // persisted storage, which survives a reload. This is the only caller of
    // `setOnLogout`; nothing calls `clearWorkspaceStorage` on logout. The query
    // cache is cleared here too so every logout path (sidebar calls the store
    // directly) drops stale workspace data before the next sign-in.
    useAuthStore.getState().setOnLogout(() => {
      clearRegisteredDraftsOnLogout();
      queryClient.clear();
    });
    return () => {
      useAuthStore.getState().setOnLogout(null);
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer />
      <QuerySessionSync queryClient={queryClient} />
      {children}
    </QueryClientProvider>
  );
}
