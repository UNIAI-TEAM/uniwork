"use client";

/**
 * Cmd+P (macOS) / Ctrl+P (elsewhere) for an open Office document (UNI-952 G-ctrlp). The format view
 * registers the SAME run function its Print menu entry calls; the Office shell
 * around it owns one keydown listener, so the shortcut works wherever focus is
 * on the page (the page header, a sidebar, a ribbon popover), not only inside
 * the editor.
 *
 * A registered run takes the shortcut: the native print of the app window is
 * prevented and the run starts. Nothing registered (the format has no port, or
 * the document is not ready) leaves the key alone: the web host keeps the
 * browser default, and the desktop host has no native Ctrl+P (its menu binds
 * no print accelerator), so the key does nothing there.
 *
 * Desktop keeps every open tab mounted; an inactive tab sits under a `hidden`
 * / `inert` panel, and its shell ignores the key so only the visible document
 * prints.
 */
import { createContext, useContext, useEffect, useId, useMemo, useRef, type ReactNode, type RefObject } from "react";

type PrintRun = () => void;

interface PrintShortcutRegistry {
  set(id: string, run: PrintRun | null): void;
}

const PrintShortcutContext = createContext<PrintShortcutRegistry | null>(null);

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Cmd on macOS (Ctrl+P is a cursor-up edit in a text field there), Ctrl elsewhere. */
function isPrintShortcut(event: KeyboardEvent): boolean {
  const primary = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return primary && !event.altKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === "p";
}

function isInactive(root: HTMLElement | null): boolean {
  return !root?.isConnected || root.closest("[hidden],[inert]") !== null;
}

/**
 * The shell's scope: views below it register their print run, and one window
 * keydown listener (capture phase, so an editor that stops propagation cannot
 * swallow it) routes the platform's print chord to the latest registered run. `rootRef` is the
 * shell element, used to tell whether this document is the visible one.
 */
export function OfficePrintShortcutScope({ rootRef, children }: { rootRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  const runs = useRef(new Map<string, PrintRun>());
  const registry = useMemo<PrintShortcutRegistry>(() => ({
    set(id, run) {
      runs.current.delete(id);
      if (run) runs.current.set(id, run);
    },
  }), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPrintShortcut(event) || isInactive(rootRef.current)) return;
      const run = [...runs.current.values()].at(-1);
      if (!run) return;
      event.preventDefault();
      // A held key repeats keydown: block the native print, start one run.
      if (!event.repeat) run();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [rootRef]);

  return <PrintShortcutContext.Provider value={registry}>{children}</PrintShortcutContext.Provider>;
}

/**
 * Binds the print chord to `run` while it is set and this view is mounted. Pass
 * the function the view's Print entry calls, or null/undefined when the view
 * cannot print now (no port, document not ready). Outside a shell scope it
 * does nothing.
 */
export function useOfficePrintShortcut(run: PrintRun | null | undefined): void {
  const registry = useContext(PrintShortcutContext);
  const id = useId();
  const latest = useRef(run);
  latest.current = run;
  const enabled = Boolean(run);
  useEffect(() => {
    if (!registry || !enabled) return undefined;
    // Registered once per enable; the call reads the latest function, so a new
    // run identity on every render neither re-registers nor reorders.
    registry.set(id, () => latest.current?.());
    return () => registry.set(id, null);
  }, [enabled, id, registry]);
}
