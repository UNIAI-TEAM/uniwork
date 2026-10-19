"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import { useOptionalNavigation } from "../navigation";
import { dropSearchParams } from "./drop-search-params";

/**
 * `?mention=1` is the link a `document_body_mentioned` notification carries
 * (UNI-1968). Once the page is ready — a file on mount, a page once its
 * editor is mounted — the parameter is consumed exactly once: the first
 * mention naming the signed-in reader scrolls into view and flashes, then
 * the address is replaced without it, so a reload or a copied URL never
 * scrolls again. A reader with no mention (or none at all) still loses the
 * parameter and the page stays at the top. Other parameters stay.
 */
export function useMentionDeepLink({
  ready,
  reveal,
}: {
  ready: boolean;
  reveal: (userId: string) => void;
}): void {
  const nav = useOptionalNavigation();
  const requested = nav?.searchParams.get("mention") === "1";
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const navRef = useRef(nav);
  navRef.current = nav;
  const consumedRef = useRef(false);

  useEffect(() => {
    const current = navRef.current;
    if (!requested || !ready || !current || consumedRef.current) return;
    consumedRef.current = true;
    const userId = useAuthStore.getState().user?.id;
    if (userId) revealRef.current(userId);
    dropSearchParams(current, ["mention"]);
  }, [requested, ready]);
}
