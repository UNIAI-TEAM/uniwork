"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Prefetch the next older page before the reader reaches the loaded edge (Telegram-style). */
export const CHAT_OLDER_PREFETCH_ROOT_MARGIN_PX = 720;

/**
 * Fires `onPrefetch` at most once per intersection cycle; waits until the prior
 * fetch settles before observing again.
 */
export function useChatOlderPrefetch(
  scrollRef: RefObject<HTMLDivElement | null>,
  sentinelRef: RefObject<HTMLElement | null>,
  options: {
    enabled: boolean;
    loadingOlder: boolean;
    onPrefetch: () => void | Promise<unknown>;
  },
): void {
  const inFlightRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const onPrefetchRef = useRef(options.onPrefetch);
  onPrefetchRef.current = options.onPrefetch;

  useEffect(() => {
    if (!options.enabled) return;
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (options.loadingOlder || inFlightRef.current) return;
        if (Date.now() < cooldownUntilRef.current) return;
        inFlightRef.current = true;
        void Promise.resolve(onPrefetchRef.current()).finally(() => {
          inFlightRef.current = false;
          cooldownUntilRef.current = Date.now() + 900;
        });
      },
      {
        root,
        rootMargin: `${CHAT_OLDER_PREFETCH_ROOT_MARGIN_PX}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [options.enabled, options.loadingOlder, scrollRef, sentinelRef]);
}
