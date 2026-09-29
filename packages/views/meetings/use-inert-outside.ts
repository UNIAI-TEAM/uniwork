"use client";
import { useEffect, type RefObject } from "react";

/**
 * Live regions and the toast stack stay reachable: the room still raises
 * toasts. Custom elements are the host's own (a route announcer keeps its live
 * region in a shadow root this query cannot see), never workspace chrome.
 */
function staysLive(el: HTMLElement): boolean {
  return (
    el.tagName.includes("-") ||
    el.matches("script, style, [aria-live], [data-sonner-toaster]") ||
    el.querySelector("[aria-live], [data-sonner-toaster]") !== null
  );
}

/**
 * The room is a full-screen layer over the workspace shell, which stays
 * mounted underneath. Everything outside the layer becomes `inert` — out of
 * the tab order and the accessibility tree — so Tab no longer walks through
 * the hidden sidebar and header first. Portals the room opens later mount
 * after this runs and stay interactive; the attribute comes off on unmount.
 */
export function useInertOutside(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    const made: HTMLElement[] = [];
    let node: HTMLElement = layer;
    while (node.parentElement && node !== document.body) {
      const parent: HTMLElement = node.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        if (sibling.hasAttribute("inert") || staysLive(sibling)) continue;
        sibling.setAttribute("inert", "");
        made.push(sibling);
      }
      node = parent;
    }
    return () => {
      for (const el of made) el.removeAttribute("inert");
    };
  }, [ref]);
}
