"use client";

/**
 * HtmlFind — the find/replace integration for the HTML surface (UNI-928).
 *
 * It owns nothing but the OPEN state: the query, the flags, the counter and the
 * active match all live in the shared `FindReplacePanel` (S4) and the matching
 * is S4's matcher, exactly as the Markdown host (`markdown/wysiwyg/find.tsx`)
 * uses them. The searched text is the HTML document's SOURCE string - the one
 * text the surface edits - so a hit is a hit in the bytes that get saved.
 *
 * It adds the three things a host has to add, and nothing else:
 *
 *   1. The key bindings, on the document in the CAPTURE phase. `Ctrl/Cmd+F`
 *      opens the panel find-only, `Ctrl/Cmd+H` shows the same panel with the
 *      replace row, Escape closes it (the panel reports that through
 *      `onClose`). The capture listener calls `preventDefault()`, which is also
 *      what keeps CodeMirror's own `Mod-f` binding (the source editor mounts
 *      `searchKeymap`) from opening a SECOND, native find panel: CodeMirror's
 *      `eventBelongsToEditor` bails on a `defaultPrevented` event, so exactly
 *      one panel exists.
 *   2. The write path. A replacement goes through the shared `TextEditorHandle`
 *      text port, then `onChange`/`onCheckpoint`, so it is dirty-checked and
 *      saved by the same coordinator as a typed keystroke - never a direct
 *      CodeMirror dispatch from outside the editor that owns the view.
 *   3. The mount. The panel is docked in the frame's own `subbar` slot - the
 *      row `OfficeFrame` documents for "ruler, formula bar, find bar" - so it
 *      is a full-width row above the canvas and can never cover the page
 *      header. Closed, it renders NOTHING, so no empty chrome row is drawn.
 *
 * Known follow-up: the source pane is CodeMirror and this host cannot paint
 * the matches inside it (the view lives in `html/source/editor.tsx`, outside
 * this task's write scope). The panel still counts and steps through every
 * match; painting the active match in the pane needs a change there.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  applyEdits,
  FindReplacePanel,
  type FindReplaceEdit,
  type FindReplacePanelHandle,
} from "../common/find";
import type { TextEditorHandle } from "../source-editor-types";
import { useOfficeDocumentActiveRef } from "../common/document-active";

/** The imperative surface a host's chrome affordance (C6) calls. */
export interface HtmlFindHandle {
  /** Open the panel; `replace` also shows the replace row (Ctrl+H). */
  open: (replace?: boolean) => void;
  close: () => void;
}

export interface HtmlFindProps {
  /** The ONE shared text source the surface edits through. */
  handle: TextEditorHandle;
  /** Read-only when false. Defaults to true. */
  editable?: boolean;
  /** Called after an applied replacement, with the new source text. */
  onChange?: (next: string) => void;
  /** Called after an applied replacement so the host can checkpoint the draft. */
  onCheckpoint?: () => void;
  className?: string;
  ref?: Ref<HtmlFindHandle>;
}

function readSource(handle: TextEditorHandle): string {
  if (handle.source) return handle.source.getText();
  return handle.getText?.() ?? "";
}

function writeSource(handle: TextEditorHandle, text: string): void {
  if (handle.source) handle.source.setText(text);
  else handle.setText?.(text);
}

export function HtmlFind({
  handle,
  editable = true,
  onChange,
  onCheckpoint,
  className,
  ref,
}: HtmlFindProps) {
  const panelRef = useRef<FindReplacePanelHandle>(null);
  const [open, setOpen] = useState(false);
  const [replaceVisible, setReplaceVisible] = useState(false);
  const [sourceText, setSourceText] = useState(() => readSource(handle));

  const openWith = useCallback((replace: boolean) => {
    setReplaceVisible(replace);
    setOpen(true);
    requestAnimationFrame(() => panelRef.current?.focus());
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useImperativeHandle(ref, () => ({ open: (replace = false) => openWith(replace), close }), [close, openWith]);

  // Ctrl/Cmd+F is find-only, Ctrl/Cmd+H shows the replace row. Capture on the
  // document so the browser's own find never wins AND CodeMirror's `Mod-f`
  // binding is skipped (a prevented event is not "for" the editor).
  // UNI-957: a hidden tab's panel must not answer the shortcut.
  const documentActiveRef = useOfficeDocumentActiveRef();
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!documentActiveRef.current) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (key !== "f" && key !== "h") return;
      event.preventDefault();
      openWith(key === "h");
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [documentActiveRef, openWith]);

  // Follow the shared text port, so an external edit (or a replacement applied
  // here) re-runs the matcher on the new bytes.
  useEffect(() => {
    setSourceText(readSource(handle));
    const port = handle.source;
    if (!port?.subscribe) return undefined;
    return port.subscribe((next) => setSourceText(next));
  }, [handle]);

  const applySourceEdits = useCallback(
    (edits: readonly FindReplaceEdit[]) => {
      const current = readSource(handle);
      const next = applyEdits(current, edits);
      if (next === current) return;
      writeSource(handle, next);
      setSourceText(next);
      onChange?.(next);
      onCheckpoint?.();
    },
    [handle, onChange, onCheckpoint],
  );

  const onReplace = useCallback(
    (edit: FindReplaceEdit) => {
      if (!editable) return;
      applySourceEdits([edit]);
    },
    [applySourceEdits, editable],
  );
  const onReplaceAll = useCallback(
    (edits: readonly FindReplaceEdit[]) => {
      if (!editable) return;
      applySourceEdits(edits);
    },
    [applySourceEdits, editable],
  );

  if (!open) return null;

  return (
    <div className={className ?? "shrink-0 border-b border-border px-2 py-1"} data-testid="html-find">
      <FindReplacePanel
        ref={panelRef}
        text={sourceText}
        open={open}
        // `disabled` covers the WHOLE panel, query included, so a read-only
        // document could not be searched at all. Only the replace row is unsafe
        // to offer there: withhold it (the replace callbacks already refuse when
        // `!editable`, so a stray invocation can never write).
        replaceVisible={replaceVisible && editable}
        onClose={close}
        onReplace={onReplace}
        onReplaceAll={onReplaceAll}
      />
    </div>
  );
}
