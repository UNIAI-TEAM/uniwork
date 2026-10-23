"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

function focusWindow(iframe: HTMLIFrameElement) {
  try { iframe.contentWindow?.focus(); } catch { /* a frame that is not same-origin keeps the iframe focus */ }
}

/**
 * Hands keyboard focus back to the editor in the frame.
 *
 * `focusFrame` focuses the iframe and its window now. `finalFocus` is for a Base UI
 * dialog's `finalFocus`: Base UI moves focus again after its close transition and
 * ignores a `false` return, so it falls back to the page control that had focus
 * before the dialog. Returning the iframe makes that last move land in the frame.
 */
export function useFrameFocus(iframeRef: RefObject<HTMLIFrameElement | null>) {
  const unmounting = useRef(false);
  // A layout cleanup runs before the dialog's own on unmount: a leave that navigates away has no frame to refocus.
  useLayoutEffect(() => {
    unmounting.current = false;
    return () => { unmounting.current = true; };
  }, []);
  const live = useCallback((): HTMLIFrameElement | null => {
    const iframe = iframeRef.current;
    return unmounting.current || !iframe?.isConnected ? null : iframe;
  }, [iframeRef]);
  const focusFrame = useCallback(() => {
    const iframe = live();
    if (!iframe) return;
    iframe.focus();
    focusWindow(iframe);
  }, [live]);
  // Base UI focuses the element it is handed itself; `true` keeps its default (a leave that navigates away).
  const finalFocus = useCallback((): HTMLIFrameElement | boolean => {
    const iframe = live();
    if (!iframe) return true;
    focusWindow(iframe);
    return iframe;
  }, [live]);
  return { focusFrame, finalFocus };
}
