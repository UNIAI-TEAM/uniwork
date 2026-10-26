"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * An object URL for a Blob, revoked when the Blob changes or the view leaves.
 * Created in an effect (not during render) so StrictMode's double render never
 * leaks one.
 */
export function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export interface FullscreenControl {
  /** False where the browser has no element fullscreen (iPhone Safari): the control is not offered. */
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

/**
 * Fullscreen for one element. Esc is the browser's own exit, so the state
 * follows `fullscreenchange` instead of trusting the button.
 */
export function useFullscreen(target: RefObject<HTMLElement | null>): FullscreenControl {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(window.document.fullscreenElement !== null && window.document.fullscreenElement === target.current);
    window.document.addEventListener("fullscreenchange", sync);
    return () => window.document.removeEventListener("fullscreenchange", sync);
  }, [target]);
  const toggle = useCallback(() => {
    if (window.document.fullscreenElement) {
      void window.document.exitFullscreen().catch(() => undefined);
    } else {
      void target.current?.requestFullscreen?.().catch(() => undefined);
    }
  }, [target]);
  return { supported: typeof window !== "undefined" && window.document.fullscreenEnabled === true, active, toggle };
}
