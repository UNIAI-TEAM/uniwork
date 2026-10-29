"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `onRestore` when the browser brings this page back from its
 * back/forward cache (pageshow with `persisted`): React state is restored
 * frozen as it was when the page was left. A screen that set "leaving for
 * the provider" before a cross-origin hand-off would otherwise come back
 * from Back as a spinner with no way out; it resets that state here.
 */
export function usePageRestore(onRestore: () => void): void {
  const latest = useRef(onRestore);
  useEffect(() => {
    latest.current = onRestore;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) latest.current();
    };
    window.addEventListener("pageshow", shown);
    return () => window.removeEventListener("pageshow", shown);
  }, []);
}
