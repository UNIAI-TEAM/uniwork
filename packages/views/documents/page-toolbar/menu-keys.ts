import type { KeyboardEvent } from "react";

/** Arrow/Home/End moves focus between the items of a menu popup. */
export function menuArrowKeys(event: KeyboardEvent<HTMLElement>): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)'));
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

/** Move focus into a menu only when it was opened from the keyboard; a mouse open keeps the editor selection. */
export const focusOnKeyboardOpen = (openType: string): boolean => openType === "keyboard";
