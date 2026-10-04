"use client";

/**
 * MarkdownFind — the find/replace integration for the Markdown surface (M7).
 *
 * It owns nothing but the OPEN state: the query, the flags, the counter and the
 * active match all live in S4's shared `FindReplacePanel`, and the matching
 * itself is S4's matcher. This module adds the three things a host has to add:
 *
 *   1. The key bindings. `Ctrl/Cmd+F` opens the panel in find-only mode and
 *      `Ctrl/Cmd+H` opens the same panel with the replace row; Escape closes it
 *      (the panel reports that through `onClose`). The two gestures differ by
 *      exactly one prop, `replaceVisible`.
 *   2. The highlight, in both modes. In the WYSIWYG mode the panel searches the
 *      FLATTENED document text (the same string `find-decoration.ts` maps back
 *      to document positions) and every match is painted by the ProseMirror
 *      decoration plugin, the active one distinguishable. In the SOURCE mode
 *      the textarea cannot be painted in place, so the active match is selected
 *      and scrolled to, and the whole-document overlay from `find-source.tsx`
 *      is portaled over the field when the host supplies its wrapper, mirroring
 *      the field's scroll so the marks stay on their own lines.
 *   3. The write path. A replacement never touches the DOM: the source mode
 *      writes through the shared `TextEditorHandle`'s text port, and the
 *      WYSIWYG mode dispatches one ProseMirror transaction that the editor
 *      publishes back through the same port - so the edit is dirty-checked and
 *      saved by the same coordinator as a typed keystroke, never by a direct
 *      textarea write.
 *
 * Scope: the integration only. The panel and the matcher are S4's; the
 * decoration and the overlay are this task's own files.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Fragment } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import {
  applyEdits,
  FindReplacePanel,
  type FindMatch,
  type FindReplaceEdit,
  type FindReplacePanelHandle,
  type FindResult,
} from "../../common/find";
import type { TextEditorHandle } from "../../source-editor-types";
import {
  applyMarkdownFindHighlight,
  buildMarkdownFindHighlight,
  clearMarkdownFindHighlight,
  createMarkdownFindPlugin,
  EMPTY_FLATTENED_DOC,
  flattenDocText,
  markdownFindPluginKey,
  matchToPmRange,
  type FlattenedDoc,
} from "./find-decoration";
import { MarkdownFindSourceHighlight, selectSourceMatch } from "./find-source";

const EMPTY_RESULT: FindResult = { matches: [], count: 0, invalidPattern: false };

/** The imperative surface a host's chrome affordance (C6) calls. */
export interface MarkdownFindHandle {
  /** Open the panel; `replace` also shows the replace row (Ctrl+H). */
  open: (replace?: boolean) => void;
  close: () => void;
}

export interface MarkdownFindProps {
  /**
   * The live WYSIWYG instance (M1's `onEditorReady`). Required in `visual`
   * mode; ignored in `source` mode, where the handle's text port is the source.
   */
  editor?: Editor | null;
  /** The ONE shared text source the surface edits through. */
  handle: TextEditorHandle;
  /** Which half of the surface is showing; decides the searched text. */
  mode?: "visual" | "source";
  /** Read-only when false. Defaults to true. */
  editable?: boolean;
  /** Controlled open. Omit to let the component own it (Ctrl+F / Ctrl+H / Escape). */
  open?: boolean;
  /** Controlled replace-row visibility. Omit to let the component own it. */
  replaceVisible?: boolean;
  onOpenChange?: (open: boolean) => void;
  onReplaceVisibleChange?: (visible: boolean) => void;
  /** The source textarea: the active match is selected and scrolled into view. */
  sourceTextarea?: RefObject<HTMLTextAreaElement | null>;
  /** The textarea's wrapper, if the source overlay should be mounted into it. */
  sourceOverlayTarget?: RefObject<HTMLElement | null>;
  /** Called after an applied replacement, with the new source text. */
  onChange?: (next: string) => void;
  /** Called after an applied replacement so the host can checkpoint the draft. */
  onCheckpoint?: () => void;
  className?: string;
  ref?: Ref<MarkdownFindHandle>;
}

function readSource(handle: TextEditorHandle): string {
  if (handle.source) return handle.source.getText();
  return handle.getText?.() ?? "";
}

function writeSource(handle: TextEditorHandle, text: string): void {
  if (handle.source) handle.source.setText(text);
  else handle.setText?.(text);
}

/**
 * The ProseMirror content for a replacement string. A line break becomes a
 * `hardBreak` node: `TextSelection.insertText` drops a bare `\n` on the floor,
 * so a multi-line replacement would silently lose its breaks. A newline-free
 * value (the common case) is a single text node, and an empty value is an empty
 * fragment, which deletes the match.
 */
function replacementFragment(editor: Editor, value: string): Fragment {
  const parts = value.split("\n");
  // `schema.nodes` is an index signature, so the entry is `NodeType | undefined`.
  const hardBreak = editor.state.schema.nodes.hardBreak;
  const nodes = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) {
      nodes.push(hardBreak ? hardBreak.create() : editor.state.schema.text("\n"));
    }
    if (parts[i]!.length > 0) nodes.push(editor.state.schema.text(parts[i]!));
  }
  return Fragment.fromArray(nodes);
}

export function MarkdownFind({
  editor = null,
  handle,
  mode = "visual",
  editable = true,
  open,
  replaceVisible,
  onOpenChange,
  onReplaceVisibleChange,
  sourceTextarea,
  sourceOverlayTarget,
  onChange,
  onCheckpoint,
  className,
  ref,
}: MarkdownFindProps) {
  const panelRef = useRef<FindReplacePanelHandle>(null);
  const [innerOpen, setInnerOpen] = useState(false);
  const [innerReplace, setInnerReplace] = useState(false);
  const [result, setResult] = useState<FindResult>(EMPTY_RESULT);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [flat, setFlat] = useState<FlattenedDoc>(EMPTY_FLATTENED_DOC);
  const [sourceText, setSourceText] = useState(() => readSource(handle));
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);

  const isOpen = open ?? innerOpen;
  const replaceRowVisible = replaceVisible ?? innerReplace;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInnerOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const setReplaceRow = useCallback(
    (next: boolean) => {
      if (replaceVisible === undefined) setInnerReplace(next);
      onReplaceVisibleChange?.(next);
    },
    [onReplaceVisibleChange, replaceVisible],
  );

  const openWith = useCallback(
    (replace: boolean) => {
      setReplaceRow(replace);
      setOpen(true);
      requestAnimationFrame(() => panelRef.current?.focus());
    },
    [setOpen, setReplaceRow],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  useImperativeHandle(ref, () => ({ open: (replace = false) => openWith(replace), close }), [close, openWith]);

  // Ctrl/Cmd+F is find-only, Ctrl/Cmd+H shows the replace row. Capture on the
  // document so the browser's own find never wins, and ignore a composing IME.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (key !== "f" && key !== "h") return;
      event.preventDefault();
      openWith(key === "h");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openWith]);

  // Source mode follows the shared text port, so an external edit (or a
  // replacement applied here) re-runs the matcher on the new bytes.
  useEffect(() => {
    if (mode !== "source") return undefined;
    setSourceText(readSource(handle));
    const port = handle.source;
    if (!port?.subscribe) return undefined;
    return port.subscribe((next) => setSourceText(next));
  }, [handle, mode]);

  // Visual mode searches the flattened document text: the string the decoration
  // maps back to document positions. A paint-only transaction leaves the text
  // unchanged, so the identity check stops the repaint from looping.
  useEffect(() => {
    if (mode !== "visual" || !editor) {
      setFlat(EMPTY_FLATTENED_DOC);
      return undefined;
    }
    const publish = () => {
      const next = flattenDocText(editor.state.doc);
      setFlat((current) => (current.text === next.text ? current : next));
    };
    publish();
    editor.on("transaction", publish);
    return () => {
      editor.off("transaction", publish);
    };
  }, [editor, mode]);

  // The decoration plugin is registered at runtime, so M1's extension set is
  // untouched. Unregistering on unmount also drops the decorations.
  useEffect(() => {
    if (!editor) return undefined;
    editor.registerPlugin(createMarkdownFindPlugin());
    return () => {
      editor.unregisterPlugin(markdownFindPluginKey);
    };
  }, [editor]);

  // Paint every match, the active one distinct; clear when the panel closes.
  useEffect(() => {
    if (mode !== "visual" || !editor) return;
    if (!isOpen) {
      clearMarkdownFindHighlight(editor);
      return;
    }
    applyMarkdownFindHighlight(editor, buildMarkdownFindHighlight(flat, result.matches, activeIndex));
  }, [activeIndex, editor, flat, isOpen, mode, result]);

  // Source mode: put the caret on the active match and scroll it into view.
  // This effect re-runs on every source edit and every keystroke, so it must not
  // grab focus: focusing here would pull the caret out of the query box while
  // the user is still typing (the next characters would land in the document)
  // and Escape - which only the panel handles - would stop closing the panel.
  // The selection + scroll always follow the active match (that is what makes
  // Next/Previous work); focus is the one part that is conditional, and it is
  // taken only when the panel does not already hold it.
  useEffect(() => {
    if (mode !== "source") return;
    const target = sourceTextarea?.current ?? null;
    if (!target) return;
    const match = isOpen && activeIndex >= 0 ? result.matches[activeIndex] ?? null : null;
    const active = document.activeElement;
    const panelFocused = active instanceof HTMLElement && active.closest('[data-testid="find-replace-panel"]') !== null;
    selectSourceMatch(target, match, !panelFocused);
  }, [activeIndex, isOpen, mode, result, sourceTextarea]);

  // Mount the overlay into the textarea's wrapper when the host offers one.
  useEffect(() => {
    if (mode !== "source" || !isOpen) {
      setOverlayHost(null);
      return;
    }
    setOverlayHost(sourceOverlayTarget?.current ?? null);
  }, [isOpen, mode, sourceOverlayTarget, sourceText]);

  const searchText = mode === "visual" ? flat.text : sourceText;

  const applyVisualEdits = useCallback(
    (edits: readonly FindReplaceEdit[]) => {
      if (!editor) return;
      const pairs = edits
        .map((edit) => ({ edit, range: matchToPmRange(flat, { start: edit.start, end: edit.end }) }))
        .filter((pair): pair is { edit: FindReplaceEdit; range: NonNullable<ReturnType<typeof matchToPmRange>> } => pair.range !== null)
        .sort((left, right) => right.range.from - left.range.from);
      if (pairs.length === 0) return;
      // One transaction: the editor publishes it through the shared text port,
      // so the replacement is dirty-checked and saved like a typed edit.
      const tr = editor.state.tr;
      for (const { edit, range } of pairs) {
        tr.replaceWith(range.from, range.to, replacementFragment(editor, edit.replacement));
      }
      editor.view.dispatch(tr);
    },
    [editor, flat],
  );

  const applySourceEdits = useCallback(
    (edits: readonly FindReplaceEdit[]) => {
      const next = applyEdits(readSource(handle), edits);
      if (next === readSource(handle)) return;
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
      if (mode === "visual") applyVisualEdits([edit]);
      else applySourceEdits([edit]);
    },
    [applySourceEdits, applyVisualEdits, editable, mode],
  );
  const onReplaceAll = useCallback(
    (edits: readonly FindReplaceEdit[]) => {
      if (!editable) return;
      if (mode === "visual") applyVisualEdits(edits);
      else applySourceEdits(edits);
    },
    [applySourceEdits, applyVisualEdits, editable, mode],
  );

  const onResultChange = useCallback((next: FindResult) => setResult(next), []);
  const onActiveMatchChange = useCallback((_match: FindMatch | null, index: number) => setActiveIndex(index), []);

  const overlay = useMemo(() => {
    if (mode !== "source" || !overlayHost) return null;
    return createPortal(
      <MarkdownFindSourceHighlight
        text={searchText}
        matches={result.matches}
        activeIndex={activeIndex}
        textarea={sourceTextarea?.current ?? null}
      />,
      overlayHost,
    );
  }, [activeIndex, mode, overlayHost, result, searchText, sourceTextarea]);

  return (
    <>
      {isOpen ? (
        <div className={className ?? "absolute top-2 right-2 z-20"} data-testid="md-find">
          <FindReplacePanel
            ref={panelRef}
            text={searchText}
            open={isOpen}
            // `disabled` covers the WHOLE panel, query included, so a read-only
            // document could not be searched at all. Only the replace row is
            // unsafe to offer there, and the panel has no per-row switch: withhold
            // the row instead (the replace callbacks already refuse when
            // `!editable`, so a stray invocation can never write).
            replaceVisible={replaceRowVisible && editable}
            onClose={close}
            onReplace={onReplace}
            onReplaceAll={onReplaceAll}
            onResultChange={onResultChange}
            onActiveMatchChange={onActiveMatchChange}
          />
        </div>
      ) : null}
      {overlay}
    </>
  );
}
