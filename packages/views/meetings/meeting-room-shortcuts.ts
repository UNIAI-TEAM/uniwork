"use client";
import { useEffect, useRef } from "react";

/** Where a keystroke is someone typing, not a command. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

/** How the shortcut for `key` reads on this platform: "⌘D" or "Ctrl+D". */
export function roomShortcutLabel(key: "D" | "E"): string {
  return isApplePlatform() ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * Ctrl/⌘+D toggles the microphone and Ctrl/⌘+E the camera, as in other call
 * apps. The browser's own binding (bookmark, search) is cancelled only when
 * the keystroke is ours, and never while the viewer is typing.
 */
export function useRoomMediaShortcuts({
  onToggleMic,
  onToggleCamera,
}: {
  onToggleMic: () => void;
  onToggleCamera: () => void;
}) {
  const handlers = useRef({ onToggleMic, onToggleCamera });
  handlers.current = { onToggleMic, onToggleCamera };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key !== "d" && key !== "e") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (key === "d") handlers.current.onToggleMic();
      else handlers.current.onToggleCamera();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
