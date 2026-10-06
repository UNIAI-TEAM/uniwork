"use client";

/**
 * The in-place text editor's lifecycle in the PPTX editor (A1ui; pulled out of
 * pptx-editor.tsx in UNI-927 W10a).
 *
 * It owns the open target, the commit through the host channel, the canvas refocus
 * after close (W2 review F3), and `flushTextEdit` (W8 review F2): the overlay commits
 * on blur, and a host chord (Ctrl+S) bubbles out of it while the edit is still open,
 * so a deck command that serializes or navigates first blurs the open editor - the
 * existing commit path - and awaits that commit before it runs.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PptxTextCommit } from "./text/pptx-text-editor";
import type { PptxTextTarget } from "./text/text-model";

interface PptxInPlaceTextInput {
  rootRef: RefObject<HTMLElement | null>;
  onCommitText?: (commit: PptxTextCommit) => Promise<unknown> | void;
  onDirty?: () => void;
  onOpen: () => void;
  onError: (error: unknown) => void;
  /** The current slide's text elements and the canvas selection, for the selection opener. */
  textTargets: readonly PptxTextTarget[];
  selectedIds: () => readonly string[];
}

export function usePptxInPlaceText({ rootRef, onCommitText, onDirty, onOpen, onError, textTargets, selectedIds }: PptxInPlaceTextInput) {
  const [textTarget, setTextTarget] = useState<PptxTextTarget | null>(null);
  // Opened by typing over the selection (UNI-958): the typed text replaces the element's.
  const [typed, setTyped] = useState(false);
  // The commit in flight (never rejects) so a command can await it; null once it settled.
  const commitRef = useRef<Promise<void> | null>(null);

  // A1ui: the in-place editor is only mounted when the host bound the commit channel.
  const openTextEditor = useCallback((target: PptxTextTarget, typedText?: string) => {
    if (!onCommitText) return false;
    onOpen();
    setTyped(typedText !== undefined);
    setTextTarget(typedText === undefined ? target : { ...target, text: typedText });
    return true;
  }, [onCommitText, onOpen]);

  // The ribbon Text command (and the editor's onTextEdit seam) opens the in-place editor
  // over the selected text element; with nothing selected it falls back to the seam.
  // UNI-958: typing over ONE selected text element opens it with the typed text.
  const textTargetsRef = useRef(textTargets);
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => { textTargetsRef.current = textTargets; selectedIdsRef.current = selectedIds; }, [selectedIds, textTargets]);
  const openTextEditorForSelection = useCallback((typedText?: string) => {
    const ids = selectedIdsRef.current();
    if (typedText !== undefined && ids.length !== 1) return false;
    const target = ids.length ? textTargetsRef.current.find((candidate) => candidate.sourceId === ids[0]) : undefined;
    return target ? openTextEditor(target, typedText) : false;
  }, [openTextEditor]);

  // W2 review F3: closing the in-place editor unmounts the focused contenteditable;
  // focus that fell to the body returns to the canvas so its keys keep working.
  const refocusCanvasRef = useRef(false);
  useEffect(() => {
    if (textTarget || !refocusCanvasRef.current) return;
    refocusCanvasRef.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    rootRef.current?.querySelector<HTMLElement>("[data-pptx-canvas]")?.focus();
  }, [rootRef, textTarget]);
  const closeTextEditor = useCallback(() => {
    refocusCanvasRef.current = true;
    setTextTarget(null);
  }, []);

  const commitText = useCallback((commit: PptxTextCommit) => {
    closeTextEditor();
    if (!onCommitText) return;
    const applied = Promise.resolve(onCommitText(commit)).then(() => { onDirty?.(); });
    const settled: Promise<void> = applied.catch(() => undefined).then(() => {
      if (commitRef.current === settled) commitRef.current = null;
    });
    commitRef.current = settled;
    void applied.catch(onError);
  }, [closeTextEditor, onCommitText, onDirty, onError]);

  /** Commits an open in-place edit through its blur path. Returns the commit to await,
   *  or null when nothing is in flight, so an idle command still runs synchronously. */
  const flushTextEdit = useCallback((): Promise<void> | null => {
    const editor = rootRef.current?.querySelector<HTMLElement>("[data-pptx-text-editor]");
    if (editor && editor === document.activeElement) editor.blur();
    return commitRef.current;
  }, [rootRef]);

  return { textTarget, typed, openTextEditor, openTextEditorForSelection, closeTextEditor, commitText, flushTextEdit };
}
