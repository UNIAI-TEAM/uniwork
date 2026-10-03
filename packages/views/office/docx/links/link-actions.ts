import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

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

export function openLinkHref(href: string): void {
  if (typeof window === "undefined") return;
  window.open(href, "_blank", "noopener,noreferrer");
}

export interface LinkClickOptions {
  /** Test/host seam for how a jump is performed; defaults to window.open. */
  open?: (href: string) => void;
}

/**
 * Modifier-click on a link: opens it and reports handled, so a host that calls
 * this from a click listener never turns the gesture into a caret placement.
 * Returns false for every other click.
 */
export function handleLinkModifierClick(event: MouseEvent, options: LinkClickOptions = {}): boolean {
  if (!isLinkModifierClick(event)) return false;
  const href = linkHrefFromTarget(event.target);
  if (!href) return false;
  event.preventDefault();
  (options.open ?? openLinkHref)(href);
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
 * Modifier-click handling for the editing surface: mousedown swallows the
 * gesture (no caret move), click opens the target in a new tab.
 *
 * Wiring follow-up pending A1: this extension is not registered yet — add it
 * to `docxExtensions()` in docx-schema.ts (one line, a shared file this task
 * must not edit) or append it to the Editor's extension list in
 * use-docx-tiptap-handle.ts.
 */
export function createDocxLinkClickExtension(options: LinkClickOptions = {}): Extension {
  const open = options.open ?? openLinkHref;
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
              click: (_view, event) => {
                if (!isLinkModifierClick(event)) return false;
                const href = linkHrefFromTarget(event.target);
                if (!href) return false;
                event.preventDefault();
                open(href);
                return true;
              },
            },
          },
        }),
      ];
    },
  });
}
