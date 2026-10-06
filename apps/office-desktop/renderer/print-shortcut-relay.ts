import type { RendererBridge } from "./app";

/** The shell's rule (print/shortcut.tsx): Cmd+P on macOS, Ctrl+P elsewhere. */
function printShortcutModifier(): "metaKey" | "ctrlKey" {
  return typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent) ? "metaKey" : "ctrlKey";
}

/**
 * Hands the main process's print chord (main/print-shortcut.ts) to the Office
 * shell. Main claims the chord so a key pressed inside a sandboxed preview
 * iframe, which never reaches this window, still prints; here it becomes the
 * same keydown the shell's one listener already routes (print/shortcut.tsx), so
 * the visible document's Print runs, a hidden tab ignores it, and a screen with
 * no document prints nothing. Returns the unsubscribe.
 */
export function relayNativePrintShortcut(bridge: Pick<RendererBridge, "onOfficePrintRequested">): () => void {
  const off = bridge.onOfficePrintRequested?.(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", [printShortcutModifier()]: true, bubbles: true, cancelable: true }));
  });
  return () => off?.();
}
