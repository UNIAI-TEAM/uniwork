import { useEffect, type RefObject } from "react";

const ITEM_SELECTOR = "button, [data-toolbar-item]";
const VALUE_CONTROL_SELECTOR = "input, select, textarea, [role='combobox'], [role='listbox'], [role='slider'], [role='spinbutton']";
const NAV_KEYS = ["ArrowRight", "ArrowLeft", "Home", "End"];

function toolbarItems(root: HTMLElement): HTMLElement[] {
  // aria-disabled controls stay in the roving set: they keep their tab order
  // (so a keyboard user can reach them to hear why they are unavailable), and
  // only a real `disabled` attribute takes an item out of the toolbar.
  return Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter((item) => !item.hasAttribute("disabled"));
}

/**
 * Roving tabindex + arrow-key navigation for the command strip (APG toolbar
 * pattern): the strip is one tab stop, arrows move focus between the visible
 * items, Home/End jump to the ends. Items that open a menu or hold a value
 * keep their own arrow behaviour.
 */
export function useRovingToolbar(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const sync = (preferred?: HTMLElement | null) => {
      const items = toolbarItems(root);
      if (items.length === 0) return;
      const current =
        (preferred && items.includes(preferred) ? preferred : null) ??
        items.find((item) => item.dataset.toolbarCurrent === "true") ??
        items[0];
      for (const item of items) {
        const active = item === current;
        item.tabIndex = active ? 0 : -1;
        if (active) item.dataset.toolbarCurrent = "true";
        else delete item.dataset.toolbarCurrent;
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(ITEM_SELECTOR) : null;
      if (target && root.contains(target)) sync(target);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!NAV_KEYS.includes(event.key)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || target.closest(VALUE_CONTROL_SELECTOR)) return;
      const items = toolbarItems(root);
      const index = items.findIndex((item) => item === target || item.contains(target));
      if (index < 0) return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowRight"
              ? Math.min(index + 1, items.length - 1)
              : Math.max(index - 1, 0);
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
  }, [ref]);
}
