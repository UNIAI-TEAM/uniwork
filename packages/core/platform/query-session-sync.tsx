"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStore } from "../auth/store";

/** Refetch server state after client-side sign-in; boot load uses mount fetch. */
export function QuerySessionSync({ queryClient }: { queryClient: QueryClient }) {
  useEffect(() => {
    let prevStatus = useAuthStore.getState().status;
    return useAuthStore.subscribe((state) => {
      if (state.status === "authed" && prevStatus === "anon") {
        void queryClient.invalidateQueries();
      }
      prevStatus = state.status;
    });
  }, [queryClient]);
  return null;
}
