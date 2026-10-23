"use client";

import { useEffect, useRef } from "react";

/** Reset a persistent list viewport when its logical page changes. */
export function useListScrollReset<T extends HTMLElement>(resetKey: string | number) {
  const scrollRef = useRef<T>(null);
  const previousKey = useRef(resetKey);

  useEffect(() => {
    if (previousKey.current === resetKey) return;
    previousKey.current = resetKey;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey]);

  return scrollRef;
}
