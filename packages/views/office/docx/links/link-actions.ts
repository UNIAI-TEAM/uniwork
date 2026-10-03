import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isValidLinkHref } from "./link-commands";

/** Word's jump gesture: Ctrl on Windows/Linux, Cmd on macOS, primary button only. */
export function isLinkModifierClick(event: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey">): boolean {
  return event.button === 0 && (event.ctrlKey || event.metaKey);
}

/** The href of the link ancestor of a click target, if the click landed on one. */
export function linkHrefFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const href = target.closest("a[href]")?.getAttribute("href");
  return href ? href : null;
}

/**
 * Opens an allowlisted link in a new tab. A document can carry arbitrary
 * schemes in its anchors (the vendored link mark parses `a[href]` verbatim),
 * so every open path re-checks the scheme here: blocked hrefs are dropped and
 * report false instead of reaching window.open.
 */
export function openLinkHref(href: string): boolean {
  const target = href.trim();
  if (!isValidLinkHref(target)) return false;
  if (typeof window === "undefined") return false;
  window.open(target, "_blank", "noopener,noreferrer");
  return true;
}

export interface LinkClickOptions {
  /** Test/host seam for how a jump is performed; the scheme gate runs before it. */
  open?: (href: string) => void;
}

/**
 * Modifier-click on a link: consumes the gesture so the browser never follows
 * the anchor itself, and opens the target only when its scheme is allowlisted.
 * Blocked schemes are still consumed (the modifier-click never falls through
 * to a caret move or a browser navigation). Returns false for non-modifier
 * clicks and clicks that miss a link.
 */
export function handleLinkModifierClick(event: MouseEvent, options: LinkClickOptions = {}): boolean {
  if (!isLinkModifierClick(event)) return false;
  const href = linkHrefFromTarget(event.target);
  if (!href) return false;
  event.preventDefault();
  if (isValidLinkHref(href)) (options.open ?? openLinkHref)(href);
  return true;
}

/** Clipboard write for the chip's Copy action; false when the host exposes no clipboard. */
export async function copyLinkHref(href: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard) return false;
  await clipboard.writeText(href);
  return true;
}

const linkClickKey = new PluginKey("docxLinkClick");

/**
 * Modifier-click handling for the editing surface, registered by
 * `docxExtensions()` in docx-schema.ts: mousedown swallows the gesture so the
 * caret does not move, click opens the target in a new tab. Both handlers
 * share `handleLinkModifierClick`, so the scheme gate holds for the editor
 * surface exactly as it does for the chip's Open action.
 */
export function createDocxLinkClickExtension(options: LinkClickOptions = {}): Extension {
  return Extension.create({
    name: "docxLinkClick",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: linkClickKey,
          props: {
            handleDOMEvents: {
              mousedown: (_view, event) => {
                if (!isLinkModifierClick(event) || !linkHrefFromTarget(event.target)) return false;
                // Keep ProseMirror from moving the caret to the click point.
                event.preventDefault();
                return true;
              },
              click: (_view, event) => handleLinkModifierClick(event, options),
            },
          },
        }),
      ];
    },
  });
}
