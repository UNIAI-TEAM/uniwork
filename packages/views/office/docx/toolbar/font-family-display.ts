"use client";

// The family box's readout for an unstyled run: Word shows the real face
// ("Calibri (Body)"), not a generic "default" label. The page root carries the
// document's resolved font stack (docDefaults/Normal), so the computed
// font-family of the editor root is the document's own default.
import type { Editor } from "@tiptap/core";

/** First family of a CSS stack, unquoted; null for empty or generic-only stacks. */
export function firstFontFamily(stack: string): string | null {
  const first = stack.split(",")[0]?.trim().replace(/^["']|["']$/g, "").trim() ?? "";
  if (!first) return null;
  return /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|inherit|initial)$/i.test(first) ? null : first;
}

/** The document's effective body font family, or null when it cannot be resolved. */
export function docxDefaultFontFamily(editor: Editor | null): string | null {
  const root = editor && !editor.isDestroyed ? (editor.view?.dom as HTMLElement | null) : null;
  const view = root?.ownerDocument?.defaultView;
  if (!root || !view) return null;
  return firstFontFamily(view.getComputedStyle(root).fontFamily);
}
