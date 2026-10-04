/**
 * The Markdown WYSIWYG extension set.
 *
 * It reuses the shared `createEditorExtensions()` (packages/views/editor) —
 * the same node/mark stack the rest of the product edits with — and changes
 * ONLY what Markdown source preservation needs:
 *
 *   1. `MarkdownRawExtension` — the opaque raw node for constructs the editor
 *      cannot represent (see raw-node.ts).
 *   2. `MarkdownSourceGapsExtension` — per-block leading separator + the
 *      document tail, so the exact blank lines between blocks survive a
 *      round-trip instead of being normalised to one blank line.
 *   3. `SelectiveMarkdown` — `@tiptap/markdown` with the selective escaper
 *      (escape.ts) and a 4-space list indent, matching genoffice.
 *
 * Nothing here is a fork: the base array is built by the shared factory and
 * only the Markdown extension itself is swapped for its selective twin.
 */
import { Extension, splitExtensions } from "@tiptap/core";
import type { AnyExtension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { createEditorExtensions, type EditorExtensionsOptions } from "../../../editor/extensions";
import { escapeSelectiveMarkdownText } from "./escape";
import { MarkdownRawExtension } from "./raw-node";

export { MarkdownRawExtension };

/** genoffice indents nested lists with four spaces. */
export const MARKDOWN_LIST_INDENT = 4;

/** Attribute holding the exact separator that preceded a block. */
export const MARKDOWN_LEAD_ATTRIBUTE = "mdLead";

/**
 * Adds the leading-separator attribute to every block node, plus the document
 * tail. `rendered: false` keeps it out of the DOM and out of Markdown; it
 * exists only in the TipTap JSON the serializer walks.
 */
export const MarkdownSourceGapsExtension = Extension.create({
  name: "markdownSourceGaps",

  addGlobalAttributes() {
    const { nodeExtensions } = splitExtensions(this.extensions);
    return [
      {
        types: nodeExtensions.filter((extension) => extension.name !== "text").map((extension) => extension.name),
        attributes: {
          [MARKDOWN_LEAD_ATTRIBUTE]: { default: null, rendered: false, keepOnSplit: false },
        },
      },
    ];
  },
});

/**
 * `@tiptap/markdown` with the selective escaper installed. The manager is
 * rebuilt on `onBeforeCreate` (the base extension does the same) so the
 * selective method replaces the stock blanket escape before any parse.
 */
export const SelectiveMarkdown = Markdown.extend({
  onBeforeCreate() {
    const manager = this.storage.manager as unknown as {
      escapeMarkdownSyntax?: (text: string) => string;
    };
    manager.escapeMarkdownSyntax = (text: string) => escapeSelectiveMarkdownText(text);
  },
});

/**
 * Build the Markdown WYSIWYG extension array: the shared set, the raw node, the
 * source-gap attributes and the selective Markdown extension.
 */
export function createMarkdownEditorExtensions(
  options: EditorExtensionsOptions = {},
): AnyExtension[] {
  const base = createEditorExtensions(options).filter(
    // Replace the shared Markdown config (3-space indent, blanket escaping)
    // with the selective 4-space twin. The remaining base array is untouched.
    (extension) => extension.name !== "markdown",
  );
  return [
    ...base,
    MarkdownRawExtension,
    MarkdownSourceGapsExtension,
    SelectiveMarkdown.configure({
      indentation: { style: "space", size: MARKDOWN_LIST_INDENT },
    }),
  ];
}
