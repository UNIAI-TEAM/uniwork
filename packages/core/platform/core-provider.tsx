"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { setSchemaLogger } from "../api/schema";
import { useAuthStore } from "../auth/store";
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
    // The default instance, for a host that resolves no locale of its own.
    // i18next initialises once, so a host that DOES have one — the web app
    // reads it from a cookie — must mount its locale provider above this.
    initI18n();
    setSchemaLogger(createLogger("api"));
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
