"use client";

import { useEffect, useRef } from "react";
import { useOptionalNavigation } from "../navigation";

/**
 * `?access=requests` is the link a manager's inbox notification carries
 * (access addendum §3.4). Both entries to the share dialog read it: the
 * document actions menu and the pure admin's "Manage access" entry (§2.5).
 *
 * Once the entry knows whether it may open (`ready`), the parameter is
 * consumed exactly once: `onOpen` runs when `allowed`, and either way the
 * address is replaced without it, so a reload or a copied URL never opens the
 * dialog again and a caller who cannot administer (or an archived document)
 * loses it silently. Other parameters stay.
 */
export function useAccessRequestsDeepLink({
  allowed,
  ready = true,
  onOpen,
}: {
  allowed: boolean;
  ready?: boolean;
  onOpen: () => void;
}): void {
  const nav = useOptionalNavigation();
  const requested = nav?.searchParams.get("access") === "requests";
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const pathname = nav?.pathname;
  const search = nav?.searchParams.toString();
  const replace = nav?.replace;

  useEffect(() => {
    if (!requested || !ready || !replace || pathname === undefined) return;
    if (allowed) onOpenRef.current();
    const rest = new URLSearchParams(search);
    rest.delete("access");
    const query = rest.toString();
    replace(query ? `${pathname}?${query}` : pathname);
  }, [requested, ready, allowed, replace, pathname, search]);
}
