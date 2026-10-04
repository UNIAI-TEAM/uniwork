import { useEffect } from "react";

const ITEM_SELECTOR = "button, [role='combobox']";
const NAV_KEYS = new Set(["ArrowRight", "ArrowLeft", "Home", "End"]);

function focusables(root: HTMLElement): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  for (const item of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
    // aria-disabled items stay in the set (UI rules: reachable, announced);
    // only a real `disabled` attribute removes one.
    if (!item.hasAttribute("disabled") && !item.closest("[hidden]")) seen.add(item);
  }
  return [...seen];
}

/**
 * Roving tabindex over the ribbon body (APG toolbar pattern): the body is one
 * tab stop, ←/→ move between commands across groups, Home/End jump to the
 * ends. `onEscape` returns focus to the active tab. The DOM is re-synced on
 * every mutation so collapse stages and tab switches keep one tab stop.
 */
export function useRovingFocus(root: HTMLElement | null, onEscape?: () => void): void {
  useEffect(() => {
    if (!root) return undefined;
    const sync = (preferred?: HTMLElement | null) => {
      const items = focusables(root);
      const current =
        (preferred && items.includes(preferred) ? preferred : null) ??
        items.find((item) => item.dataset.ribbonCurrent === "true") ??
        items[0];
      for (const item of items) {
        item.tabIndex = item === current ? 0 : -1;
        if (item === current) item.dataset.ribbonCurrent = "true";
        else delete item.dataset.ribbonCurrent;
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(ITEM_SELECTOR) : null;
      if (target && root.contains(target)) sync(target);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (!NAV_KEYS.has(event.key)) return;
      const items = focusables(root);
      const index = items.findIndex((item) => item === target || item.contains(target));
      if (index < 0) return;
      event.preventDefault();
      const last = items.length - 1;
      const next =
        event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowRight" ? Math.min(index + 1, last) : Math.max(index - 1, 0);
      sync(items[next]);
      items[next]?.focus();
    };
    sync();
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("keydown", onKeyDown);
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => sync());
    observer?.observe(root, { childList: true, subtree: true });
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("keydown", onKeyDown);
      observer?.disconnect();
    };
  }, [root, onEscape]);
}
