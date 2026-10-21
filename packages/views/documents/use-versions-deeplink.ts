"use client";

import { useEffect, useRef } from "react";
import { useOptionalNavigation } from "../navigation";
import { dropSearchParams } from "./drop-search-params";

/**
 * `?panel=versions` is the link a chat document card's "Lịch sử phiên bản"
 * opens (`paths…documentVersions`, UNI-2012). Every reader may see the
 * history, so the parameter opens the panel unconditionally and is consumed
 * once: the address is replaced without it, so a reload or a copied URL lands
 * on the plain page. Other parameters stay.
 */
export function useVersionsDeepLink(onOpen: () => void): void {
  const nav = useOptionalNavigation();
  const requested = nav?.searchParams.get("panel") === "versions";
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const navRef = useRef(nav);
  navRef.current = nav;

  useEffect(() => {
    const current = navRef.current;
    if (!requested || !current) return;
    onOpenRef.current();
    dropSearchParams(current, ["panel"]);
  }, [requested]);
}
