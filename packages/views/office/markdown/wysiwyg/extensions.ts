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
import { Extension, getExtensionField, splitExtensions } from "@tiptap/core";
import type { AnyExtension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { createEditorExtensions, type EditorExtensionsOptions } from "../../../editor/extensions";
import { installSelectiveEscaper } from "./escape";
import { createMathPasteExtension } from "./math";
import { MarkdownRawExtension } from "./raw-node";

export { MarkdownRawExtension };

/** genoffice indents nested lists with four spaces. */
export const MARKDOWN_LIST_INDENT = 4;

/** Attribute holding the exact separator that preceded a block. */
export const MARKDOWN_LEAD_ATTRIBUTE = "mdLead";

/**
 * The node types that can sit at the top level of the document, plus the doc
 * node that carries the tail. Only these need the leading-separator attribute;
 * `mdLead` on an inline node (`hardBreak`, inline `image`/`math`, `mention`) is
 * never read and only widens the schema's attribute surface.
 */
function blockLevelNodeTypes(extensions: AnyExtension[]): string[] {
  return splitExtensions(extensions).nodeExtensions
    .filter((extension) => extension.name !== "text")
    .filter((extension) => {
      const context = { name: extension.name, options: extension.options, storage: extension.storage };
      if (getExtensionField(extension, "topNode", context)) return true;
      const group = getExtensionField(extension, "group", context);
      const resolved = typeof group === "function" ? group.call(context) : group;
      return typeof resolved === "string" && resolved.split(/\s+/).includes("block");
    })
    .map((extension) => extension.name);
}

/**
 * Adds the leading-separator attribute to every block-level node, plus the
 * document tail. `rendered: false` keeps it out of the DOM and out of Markdown;
 * it exists only in the TipTap JSON the serializer walks.
 */
export const MarkdownSourceGapsExtension = Extension.create({
  name: "markdownSourceGaps",

  addGlobalAttributes() {
    return [
      {
        types: blockLevelNodeTypes(this.extensions),
        attributes: {
          [MARKDOWN_LEAD_ATTRIBUTE]: { default: null, rendered: false, keepOnSplit: false },
        },
      },
    ];
  },
});

/**
 * `@tiptap/markdown` with the selective escaper installed.
 *
 * `Markdown.extend({ onBeforeCreate })` shallow-merges the config, so this
 * hook REPLACES the base one; the parent only runs when we call
 * `this.parent?.()`. The base hook is load-bearing — it rebuilds
 * `storage.manager` from `editor.extensionManager.baseExtensions`, assigns
 * `editor.markdown`, defines `editor.getMarkdown` and handles
 * `contentType: "markdown"`. Without the call, `editor.markdown` never exists
 * (markdown paste bails) and the escaper would land on the throwaway
 * `addStorage` manager nothing reads. Run the parent FIRST, then install the
 * selective escaper on the rebuilt, real manager.
 */
export const SelectiveMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    installSelectiveEscaper(this.storage.manager);
  },
});

/**
 * Options for {@link createMarkdownEditorExtensions}. Everything the shared
 * factory accepts, plus the two seams the Markdown surface needs.
 */
export interface MarkdownEditorExtensionsOptions extends EditorExtensionsOptions {
  /**
   * Replace the shared image node. M5 passes the shared `ImageExtension` with
   * its NodeView swapped for `MarkdownImageView`, so an image resolves through
   * the asset manifest instead of putting the authored path on `<img src>`.
   * Only the NodeView changes: `addAttributes` and `renderMarkdown` are
   * inherited, so the Markdown bytes an image serialises to are unchanged.
   * Omitted, the shared `ImageView` renders the node.
   */
  image?: AnyExtension;
  /**
   * Extensions appended after the Markdown set. A NodeView or a ProseMirror
   * plugin cannot mount "around" an editor the way a React panel can (a panel
   * takes the editor instance as a prop), so this is the one seam that lets
   * M5's image upload plugin - and any later surface - attach. It is strictly
   * additive: parse and serialise are untouched, so M1's byte-identity holds.
   */
  extraExtensions?: readonly AnyExtension[];
}

/**
 * Build the Markdown WYSIWYG extension array: the shared set, the raw node, the
 * source-gap attributes and the selective Markdown extension.
 */
export function createMarkdownEditorExtensions(
  options: MarkdownEditorExtensionsOptions = {},
): AnyExtension[] {
  const { image, extraExtensions, ...baseOptions } = options;
  const base = createEditorExtensions(baseOptions)
    .filter(
      // Replace the shared Markdown config (3-space indent, blanket escaping)
      // with the selective 4-space twin. The remaining base array is untouched.
      (extension) => extension.name !== "markdown",
    )
    // Swap the image node IN PLACE so the schema's node order - and therefore
    // the bytes the Markdown serializer emits - is identical whether or not a
    // host supplies its own image extension.
    .map((extension) => (image && extension.name === "image" ? image : extension));
  return [
    ...base,
    // M4: a pasted formula written with LaTeX delimiters becomes a math node.
    // It carries priority 1000 so its handlePaste runs before the shared
    // markdown-paste catch-all, which claims nearly every paste.
    createMathPasteExtension(),
    MarkdownRawExtension,
    MarkdownSourceGapsExtension,
    SelectiveMarkdown.configure({
      indentation: { style: "space", size: MARKDOWN_LIST_INDENT },
    }),
    ...(extraExtensions ?? []),
  ];
}
