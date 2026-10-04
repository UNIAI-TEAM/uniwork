"use client";

/**
 * The Mermaid diagram control (M4): insert a fenced `mermaid` block holding a
 * starter template.
 *
 * A diagram is a fenced code block whose info string is `mermaid`, which is
 * exactly what the shared node view already renders live
 * (`packages/views/editor/extensions/code-block-view.tsx` renders
 * `MermaidDiagram` for that language) and what the Markdown serializer writes
 * back as a fence. So the insert helper writes a `codeBlock` node — never a
 * second node type, and never a fork of the renderer.
 *
 * The typed error state ("invalid source shows the parser's message, not a
 * crash") lives in that shared renderer: `MermaidDiagram` catches the parse
 * failure and paints the parser message itself
 * (`packages/views/editor/mermaid-diagram.tsx`). An earlier draft of this
 * module carried a second `MermaidBlockPreview` wrapper for the same state;
 * it was mounted nowhere and re-implemented what the node view already owns, so
 * it was dropped rather than left to drift.
 */
import type { Editor } from "@tiptap/core";

/** The fence info string that marks a diagram. */
export const MERMAID_LANGUAGE = "mermaid";

/**
 * The starter diagram inserted by the toolbar control: valid on arrival, so the
 * user edits a rendered diagram rather than an empty block that shows an error.
 */
export const MERMAID_TEMPLATE = "graph TD\n  A[Start] --> B[End]\n";

/**
 * Insert a fenced `mermaid` block holding the starter template (or a caller's
 * own source) at the selection. Writes the shared `codeBlock` node so the
 * existing node view renders it and the serializer keeps the fence.
 */
export function insertMermaidDiagram(editor: Editor | null, source: string = MERMAID_TEMPLATE): void {
  if (!editor?.isEditable) return;
  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language: MERMAID_LANGUAGE },
      content: source.length > 0 ? [{ type: "text", text: source }] : [],
    })
    .run();
}
