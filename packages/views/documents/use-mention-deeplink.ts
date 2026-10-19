"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import { useOptionalNavigation } from "../navigation";
import { dropSearchParams } from "./drop-search-params";

/**
 * `?mention=1` is the link a `document_body_mentioned` notification carries
 * (UNI-1968). Once the page is ready — a file on mount, a page once its
 * editor is mounted — the first mention naming the signed-in reader scrolls
 * into view and flashes, then the address is replaced without the parameter,
 * so a reload or a copied URL never scrolls again. Other parameters stay.
 *
 * A reader who opened the document before the mention was added first sees
 * the cached body. While the reveal finds nothing and the body is still being
 * refetched (`refreshing`), the link stays pending and tries again when the
 * fetch settles with the fresh body in the editor. A reader with no mention
 * (or none at all) loses the parameter once that fetch has settled, and the
 * page stays at the top.
 */
export function useMentionDeepLink({
  ready,
  refreshing = false,
  reveal,
}: {
  ready: boolean;
  /** The document body is being refetched: a missing mention may still arrive. */
  refreshing?: boolean;
  /** Returns true when a mention naming `userId` was found and revealed. */
  reveal: (userId: string) => boolean;
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
    const userId = useAuthStore.getState().user?.id;
    const revealed = userId ? revealRef.current(userId) : false;
    if (!revealed && userId && refreshing) return;
    consumedRef.current = true;
    dropSearchParams(current, ["mention"]);
  }, [requested, ready, refreshing]);
}
