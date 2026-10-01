// TipTap/ProseMirror schema for the DOCX editing surface — new UniWork code,
// not a port of genoffice's editor/extensions.ts (see docx-renderer-port.md
// §3c). One flat block node mirrors the G2 engine's flat block-plan model
// (DocxBlock/DocxGeneratedBlock) instead of nesting lists/headings the way a
// generic rich-text editor would; every block carries the engine identity it
// binds back to (docxIndex, originalType) so the save path never guesses.
//
// Marks/undo come from @tiptap/starter-kit (already used by packages/views/
// editor since UNI-505) configured down to just what this slice needs —
// bold/italic/underline/undoRedo — rather than importing @tiptap/extensions
// or @tiptap/extension-document/-text directly: those subpaths' published
// `exports` map points `import` at a dist/index.js that isn't in the
// installed package (a real packaging gap in this @tiptap release line),
// while going through starter-kit's own already-working resolution avoids it.
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

export type DocxBlockKind = "paragraph" | "heading" | "listItem" | "other";

export interface DocxBlockList {
  kind: "bullet" | "ordered";
  numId: string;
  ilvl: number;
}

export interface DocxBlockAttrs {
  /** The engine's save-plan key. null = not yet saved (freshly inserted). */
  docxIndex: number | null;
  /** The ORIGINAL engine block.type this node was parsed from, null for a
   * freshly inserted block. Only "paragraph" originals may keep their
   * docxIndex through a text-only edit (set_paragraph_text); any other
   * original type is replaced (remove_block + insert_generated) by
   * docx-reconcile.ts the moment it is touched. */
  originalType: string | null;
  blockKind: DocxBlockKind;
  level: number | null;
  list: DocxBlockList | null;
  /** Render-only label for a read-only "other" block (table/image/passthrough
   * content phase 3 renders properly); never fed back into a save op. */
  placeholderLabel: string | null;
}

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

function tagFor(attrs: DocxBlockAttrs): string {
  if (attrs.blockKind === "heading") {
    const level = attrs.level && HEADING_LEVELS.includes(attrs.level as (typeof HEADING_LEVELS)[number]) ? attrs.level : 1;
    return `h${level}`;
  }
  return "p";
}

/**
 * One node type for every top-level block. `blockKind`/`level`/`list` decide
 * the rendered tag and a CSS marker (list bullet/number); `originalType`
 * decides what docx-reconcile.ts is legally allowed to do with it. A
 * "other" block (table/image/header-footer/passthrough — phase 3's
 * read-only renderer replaces this placeholder) is never content-editable.
 */
export const DocxBlockNode = Node.create({
  name: "docxBlock",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return {
      docxIndex: { default: null },
      originalType: { default: null },
      blockKind: { default: "paragraph" },
      level: { default: null },
      list: { default: null },
      placeholderLabel: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "p[data-docx-block]" }, { tag: "h1[data-docx-block]" }, { tag: "h2[data-docx-block]" }, { tag: "h3[data-docx-block]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as DocxBlockAttrs;
    const tag = tagFor(attrs);
    const classes = ["docx-block", `docx-block--${attrs.blockKind}`];
    if (attrs.blockKind === "listItem") classes.push(attrs.list?.kind === "ordered" ? "docx-block--list-ordered" : "docx-block--list-bullet");
    return [
      tag,
      mergeAttributes(HTMLAttributes, {
        "data-docx-block": "1",
        "data-docx-index": attrs.docxIndex ?? "",
        "data-docx-kind": attrs.blockKind,
        class: classes.join(" "),
      }),
      0,
    ];
  },
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const attrs = node.attrs as DocxBlockAttrs;
      const dom = document.createElement(tagFor(attrs));
      const classes = ["docx-block", `docx-block--${attrs.blockKind}`];
      if (attrs.blockKind === "listItem") classes.push(attrs.list?.kind === "ordered" ? "docx-block--list-ordered" : "docx-block--list-bullet");
      const merged = mergeAttributes(HTMLAttributes, {
        "data-docx-block": "1",
        "data-docx-index": attrs.docxIndex ?? "",
        "data-docx-kind": attrs.blockKind,
        class: classes.join(" "),
      });
      for (const [key, value] of Object.entries(merged)) dom.setAttribute(key, String(value));
      if (attrs.blockKind === "other") {
        dom.setAttribute("contenteditable", "false");
        dom.textContent = attrs.placeholderLabel ?? "";
        return { dom };
      }
      return { dom, contentDOM: dom };
    };
  },
});

export function docxExtensions() {
  return [
    StarterKit.configure({
      bold: {},
      italic: {},
      underline: {},
      undoRedo: {},
      dropcursor: false,
      blockquote: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      hardBreak: false,
      heading: false,
      horizontalRule: false,
      link: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
      paragraph: false,
      strike: false,
      trailingNode: false,
    }),
    DocxBlockNode,
  ];
}
