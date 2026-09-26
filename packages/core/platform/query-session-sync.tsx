"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStore } from "../auth/store";
import { clearResolvedFiles } from "../files/hooks";

function principalOf(state: ReturnType<typeof useAuthStore.getState>): string {
  return state.status === "authed" ? (state.user?.id ?? "") : "";
}

/**
 * Refetch server state after client-side sign-in; boot load uses mount fetch.
 * When the signed-in person changes, the previous person's resolved file URLs
 * are dropped at once (logout clears the whole cache in `CoreProvider`).
 */
export function QuerySessionSync({ queryClient }: { queryClient: QueryClient }) {
  useEffect(() => {
    let prevStatus = useAuthStore.getState().status;
    let prevPrincipal = principalOf(useAuthStore.getState());
    return useAuthStore.subscribe((state) => {
      const principal = principalOf(state);
      if (prevPrincipal && principal !== prevPrincipal) {
        clearResolvedFiles(queryClient, prevPrincipal);
      }
      if (state.status === "authed" && prevStatus === "anon") {
        void queryClient.invalidateQueries();
      }
      prevStatus = state.status;
      prevPrincipal = principal;
    });
  }, [queryClient]);
  return null;
}
