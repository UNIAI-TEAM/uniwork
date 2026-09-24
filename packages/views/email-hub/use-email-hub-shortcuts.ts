"use client";

import { useEffect, useRef } from "react";

export interface EmailHubShortcutHandlers {
  /** Off switches every key, "?" included (WCAG 2.1.4). */
  enabled: boolean;
  reading: boolean;
  onHelp?: () => void;
  onCompose?: () => void;
  onFocusSearch?: () => void;
  onBack?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onArchive?: () => void;
  onTrash?: () => void;
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
  onStar?: () => void;
  onMarkUnread?: () => void;
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** A dialog, sheet or menu owns the keyboard while it is open. */
function overlayOpen() {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
}

/** Moves focus between list rows — the list's own j/k before an email is open. */
function focusRow(step: 1 | -1) {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-thread-row]"));
  if (rows.length === 0) return;
  const current = rows.findIndex((row) => row === document.activeElement);
  const next = current === -1 ? (step === 1 ? 0 : rows.length - 1) : Math.min(Math.max(current + step, 0), rows.length - 1);
  rows[next]?.focus();
  rows[next]?.scrollIntoView({ block: "nearest" });
}

/**
 * The mail-client keys people already know (Gmail's set): c compose, / search,
 * j/k next/previous, e archive, # delete, r/a/f reply/all/forward, s star,
 * Shift+U unread, Esc or u back to the list, ? the list of keys. None of them
 * fire while typing, while an overlay is open, or once the reader turned them
 * off in that list.
 */
export function useEmailHubShortcuts(handlers: EmailHubShortcutHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const h = ref.current;
      if (!h.enabled && event.key !== "Escape") return;
      if (isTyping(event.target) || overlayOpen()) return;
      const run = (fn?: () => void) => {
        if (!fn) return;
        event.preventDefault();
        fn();
      };
      switch (event.key) {
        case "?":
          return run(h.enabled ? h.onHelp : undefined);
        case "c":
          return run(h.onCompose);
        case "/":
          return run(h.reading ? undefined : h.onFocusSearch);
        case "j":
          return run(h.reading ? h.onNext : () => focusRow(1));
        case "k":
          return run(h.reading ? h.onPrev : () => focusRow(-1));
        case "Escape":
        case "u":
          return run(h.reading ? h.onBack : undefined);
        case "U":
          return run(h.reading ? h.onMarkUnread : undefined);
        case "e":
          return run(h.reading ? h.onArchive : undefined);
        case "#":
          return run(h.reading ? h.onTrash : undefined);
        case "r":
          return run(h.reading ? h.onReply : undefined);
        case "a":
          return run(h.reading ? h.onReplyAll : undefined);
        case "f":
          return run(h.reading ? h.onForward : undefined);
        case "s":
          return run(h.reading ? h.onStar : undefined);
        default:
          return undefined;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
