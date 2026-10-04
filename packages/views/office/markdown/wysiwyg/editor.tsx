"use client";

/**
 * MarkdownEditorWysiwyg — the visual editor half of the Markdown surface.
 *
 * It is a controlled view over ONE text source: the `SourceTextPort` on the
 * caller's `TextEditorHandle`. Mounting parses that port's current text into
 * the editor; every edit serialises back through `setText`; and a text change
 * arriving from the source editor (or the save coordinator) is parsed back in.
 * Toggling source <-> visual therefore round-trips through the same bytes, and
 * the two views can never drift.
 *
 * The visual editor owns no document state of its own: no store, no draft, no
 * transport. Save/checkpoint goes only through the injected save coordinator,
 * never from here. No checkpoint is requested mid-IME composition (a Vietnamese
 * IME commits a word over several keystrokes; snapshotting mid-composition would
 * persist a half-typed word).
 *
 * Scope: the editor core only. The toolbar (M2), slash menu (M3), code /
 * diagram / math pickers (M4), images (M5), outline and front matter panels
 * (M6), find (M7) and print (M8) mount around it; `onEditorReady` is the hook
 * they use to reach the live TipTap instance.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { createMarkdownEditorExtensions } from "./extensions";
import { createMarkdownSourceCodec, type MarkdownSourceCodec } from "./serialize";
import type { TextEditorHandle } from "../../source-editor-types";

export interface MarkdownWysiwygEditorProps<TSnapshot = unknown> {
  /** The document this view edits. Remounts the editor when it changes. */
  documentKey: string;
  /**
   * The shared editor handle. Its `source` port is the ONE text source: the
   * visual editor reads it on mount and writes every change back to it.
   */
  editor: TextEditorHandle<TSnapshot>;
  /** Read-only when false. Defaults to true. */
  editable?: boolean;
  /**
   * Called once the TipTap instance is live, and again with `null` on
   * unmount. M2-M8 mount their UI against this instance.
   */
  onEditorReady?: (editor: Editor | null) => void;
  /** Called after each user edit that was written back to the text source. */
  onChange?: (markdown: string) => void;
  /**
   * Called when the user edits and the surface wants a draft checkpoint. The
   * caller routes it through the save coordinator; it is never invoked
   * mid-IME composition.
   */
  onCheckpoint?: () => void;
  className?: string;
  ariaLabel?: string;
}

/** The text source shared with the source editor, or the handle's fallbacks. */
function readSourceText<TSnapshot>(editor: TextEditorHandle<TSnapshot>): string {
  if (editor.source) return editor.source.getText();
  return editor.getText?.() ?? "";
}

function writeSourceText<TSnapshot>(editor: TextEditorHandle<TSnapshot>, text: string): void {
  if (editor.source) editor.source.setText(text);
  else editor.setText?.(text);
}

export function MarkdownWysiwygEditor<TSnapshot = unknown>({
  documentKey,
  editor,
  editable = true,
  onEditorReady,
  onChange,
  onCheckpoint,
  className,
  ariaLabel,
}: MarkdownWysiwygEditorProps<TSnapshot>) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown.wysiwyg" });

  // One codec per mount: the same extension set and indentation the editor
  // mounts with, so parse and serialise agree on what is representable.
  const codec: MarkdownSourceCodec = useMemo(() => createMarkdownSourceCodec(createMarkdownEditorExtensions()), []);

  // The text this component last published. A source change equal to it is our
  // own write echoing back, not an external edit, and must not be re-parsed.
  const publishedRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const applyingRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  const onCheckpointRef = useRef(onCheckpoint);
  const onReadyRef = useRef(onEditorReady);
  onChangeRef.current = onChange;
  onCheckpointRef.current = onCheckpoint;
  onReadyRef.current = onEditorReady;

  // The document the editor mounts with. Re-read in the same render that
  // switches `documentKey`, so the recreated editor cannot mount the previous
  // document's content (an effect would be one commit too late and flash the
  // wrong text).
  const initialDocRef = useRef<JSONContent | null>(null);
  const [mountedKey, setMountedKey] = useState(documentKey);
  if (initialDocRef.current === null || mountedKey !== documentKey) {
    initialDocRef.current = codec.parse(readSourceText(editor));
    publishedRef.current = null;
    if (mountedKey !== documentKey) setMountedKey(documentKey);
  }

  /** Serialise the editor document to the shared source and notify the caller. */
  const publish = useCallback(
    (doc: JSONContent) => {
      const next = codec.serialize(doc);
      if (next === publishedRef.current) return;
      publishedRef.current = next;
      writeSourceText(editor, next);
      onChangeRef.current?.(next);
      // Mid-composition the document holds a partial word; the committed text
      // is published at `compositionend`, and only then is a checkpoint safe.
      if (!composingRef.current) onCheckpointRef.current?.();
    },
    [codec, editor],
  );

  const instance = useEditor(
    {
      extensions: createMarkdownEditorExtensions(),
      content: initialDocRef.current,
      contentType: "json",
      editable,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "markdown-wysiwyg-content prose",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": ariaLabel ?? t("label"),
        },
        handleDOMEvents: {
          compositionstart: () => {
            composingRef.current = true;
            return false;
          },
          compositionend: () => {
            composingRef.current = false;
            const live = editorRef.current;
            if (live) publish(live.getJSON());
            return false;
          },
        },
      },
      onUpdate: ({ editor: live }) => {
        // Mid-composition the document holds a partial word; write nothing and
        // never checkpoint until `compositionend` publishes the committed text.
        if (composingRef.current) return;
        publish(live.getJSON());
      },
    },
    [documentKey],
  );

  editorRef.current = instance;

  useEffect(() => {
    onReadyRef.current?.(instance);
    return () => onReadyRef.current?.(null);
  }, [instance]);

  // Follow external edits: a change from the source editor (or the coordinator
  // restoring a draft) is parsed back into the visual editor.
  useEffect(() => {
    const port = editor.source;
    if (!port?.subscribe) return undefined;
    return port.subscribe((next) => {
      if (next === publishedRef.current) return;
      const live = editorRef.current;
      if (!live || applyingRef.current) return;
      applyingRef.current = true;
      try {
        live.commands.setContent(codec.parse(next), { emitUpdate: false });
        publishedRef.current = next;
      } finally {
        applyingRef.current = false;
      }
    });
  }, [editor, codec, documentKey]);

  useEffect(() => {
    if (!instance || instance.isEditable === editable) return;
    // `emitUpdate: false` — flipping editability is not a document change, and
    // the default `true` would fire onUpdate and request a spurious checkpoint.
    instance.setEditable(editable, false);
  }, [editable, instance]);

  return (
    <div
      className={cn("markdown-wysiwyg flex min-h-0 min-w-0 flex-1 flex-col", className)}
      data-testid="md-wysiwyg"
      data-document-key={documentKey}
    >
      <EditorContent
        editor={instance}
        className="min-h-64 flex-1 overflow-auto p-3"
        data-testid="md-wysiwyg-surface"
      />
    </div>
  );
}
