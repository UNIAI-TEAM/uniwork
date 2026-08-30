"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { setSchemaLogger } from "../api/schema";
import { useAuthStore } from "../auth/store";
import { initI18n } from "../i18n";
import { createLogger } from "../logger";
import { createQueryClient } from "../query-client";
import { restoreMatrixSession } from "../chat/matrix-store";

/**
 * Resolves the session once at boot. The auth store's initialize is
 * idempotent, so StrictMode's double-invoked effect and any layout that also
 * calls it collapse to a single refresh — which matters because the refresh
 * endpoint rotates the cookie.
 */
function AuthInitializer() {
  useEffect(() => {
    void useAuthStore.getState().initialize();
  }, []);
  return null;
}

function MatrixRestorer() {
  useEffect(() => {
    restoreMatrixSession();
  }, []);
  return null;
}

/**
 * The headless boot sequence every host shares: query cache, session, i18n,
 * and the schema-drift logger. Hosts wrap this in their own providers
 * (navigation, toasts) — nothing here knows which router or UI kit is
 * outside it.
 */
export function CoreProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [ready] = useState(() => {
    initI18n();
    setSchemaLogger(createLogger("api"));
    return true;
  });
  void ready;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer />
      <MatrixRestorer />
      {children}
    </QueryClientProvider>
  );
}
