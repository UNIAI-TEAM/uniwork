"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { setSchemaLogger } from "../api/schema";
import { useAuthStore } from "../auth/store";
import { resetRegisteredDraftsInMemory } from "../drafts/cleanup-registry";
// Ensure every module-level draft store has registered itself before the
// logout callback below can run, so the registry is never partially populated.
import "../drafts/register-all-drafts";
import { initI18n } from "../i18n";
import { createLogger } from "../logger";
import { createQueryClient } from "../query-client";

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
    // Memory-layer draft cleanup. The persisted half runs through
    // `clearWorkspaceStorage`; this clears the Zustand singletons, which
    // survive the client-side navigation that follows logout. Assigning the
    // single callback slot is last-write-wins, so StrictMode's double
    // invocation of this initializer registers the same callback twice with
    // no additional effect.
    useAuthStore.getState().setOnLogout(resetRegisteredDraftsInMemory);
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
