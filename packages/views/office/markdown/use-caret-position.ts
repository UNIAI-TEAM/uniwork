"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { textCaret } from "../frame";

export interface MarkdownCaret {
  line: number;
  column: number;
}

/** Visual canvas: the caret as "block line, column" - the text before it, blocks joined by newlines. */
export function visualCaret(editor: Editor): MarkdownCaret {
  const before = editor.state.doc.textBetween(0, editor.state.selection.head, "\n");
  return textCaret(before, before.length);
}

/**
 * Where the caret is, for the status row: the live TipTap selection on the
 * visual canvas, the textarea's selection in source mode. Null until the
 * surface has one (no editor yet, textarea not mounted).
 */
export function useMarkdownCaret(
  mode: "visual" | "source",
  instance: Editor | null,
  textAreaRef: RefObject<HTMLTextAreaElement | null>,
  /** The source textarea only exists once the document is open. */
  ready: boolean,
): MarkdownCaret | null {
  const [caret, setCaret] = useState<MarkdownCaret | null>(null);

  useEffect(() => {
    if (mode !== "visual" || !instance || instance.isDestroyed) return undefined;
    const read = () => setCaret(visualCaret(instance));
    read();
    instance.on("selectionUpdate", read);
    instance.on("update", read);
    return () => {
      instance.off("selectionUpdate", read);
      instance.off("update", read);
    };
  }, [mode, instance]);

  useEffect(() => {
    const area = textAreaRef.current;
    if (!ready || mode !== "source" || !area) return undefined;
    const read = () => setCaret(textCaret(area.value, area.selectionStart));
    read();
    const events = ["keyup", "click", "input", "focus", "select"] as const;
    for (const name of events) area.addEventListener(name, read);
    return () => {
      for (const name of events) area.removeEventListener(name, read);
    };
  }, [mode, ready, textAreaRef]);

  return caret;
}
