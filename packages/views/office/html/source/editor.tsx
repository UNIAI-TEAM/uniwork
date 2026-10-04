"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as cmPlaceholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export interface HtmlSourceEditorProps {
  value: string;
  readOnly?: boolean;
  /** Fired on user edits, never while an IME composition is in progress. */
  onChange(next: string): void;
  /** Fired alongside onChange when the edit is not part of a composition. */
  onCheckpoint?(): void;
  className?: string;
  ariaLabel?: string;
  /** Optional text shown when the document is empty. */
  placeholder?: string;
}

// Colours come from the semantic token layer so light and dark both read
// correctly; no literal colours are allowed here.
const uniworkHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "var(--color-muted-foreground)", fontStyle: "italic" },
  { tag: [tags.tagName, tags.typeName], color: "var(--color-brand)" },
  { tag: [tags.attributeName], color: "var(--color-info)" },
  { tag: [tags.attributeValue, tags.string], color: "var(--color-success)" },
  { tag: [tags.keyword, tags.modifier], color: "var(--color-brand-accent)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--color-warning)" },
  { tag: [tags.punctuation, tags.bracket, tags.angleBracket], color: "var(--color-muted-foreground)" },
  { tag: [tags.content], color: "var(--color-foreground)" },
  { tag: [tags.invalid], color: "var(--color-destructive)" },
]);

const uniworkTheme = EditorView.theme({
  "&": {
    color: "var(--color-foreground)",
    backgroundColor: "var(--color-background)",
    height: "100%",
    fontSize: "var(--text-body)",
  },
  ".cm-content": { caretColor: "var(--color-foreground)", fontFamily: "var(--font-mono, ui-monospace, monospace)", padding: "0.75rem" },
  ".cm-scroller": { overflow: "auto", lineHeight: "1.6" },
  ".cm-gutters": {
    backgroundColor: "var(--color-muted)",
    color: "var(--color-muted-foreground)",
    border: "none",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-activeLine": { backgroundColor: "var(--color-surface-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-surface-hover)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-foreground)" },
  "&.cm-focused": { outline: "2px solid var(--color-ring)", outlineOffset: "2px" },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--color-selection)",
    color: "var(--color-selection-foreground)",
  },
  ".cm-panels": { backgroundColor: "var(--color-surface)", color: "var(--color-surface-foreground)" },
});

const readOnlyCompartment = new Compartment();

// The editable node is CodeMirror's `.cm-content`, not this container, so the
// accessible name has to live on the content element. A compartment lets the
// label follow the prop like the readOnly flag does.
const ariaLabelCompartment = new Compartment();

// Marks transactions the component itself dispatches to mirror the controlled
// `value` prop, so they are never echoed back through onChange.
const externalSync = Annotation.define<boolean>();

function readOnlyExtensions(readOnly: boolean) {
  return [EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)];
}

function ariaLabelExtension(ariaLabel?: string) {
  return EditorView.contentAttributes.of(ariaLabel ? { "aria-label": ariaLabel } : {});
}

export function HtmlSourceEditor({ value, readOnly = false, onChange, onCheckpoint, className, ariaLabel, placeholder }: HtmlSourceEditorProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCheckpointRef = useRef(onCheckpoint);
  const composingRef = useRef(false);
  const composedChangeRef = useRef(false);
  onChangeRef.current = onChange;
  onCheckpointRef.current = onCheckpoint;

  const emitChange = (next: string, withCheckpoint: boolean) => {
    onChangeRef.current(next);
    if (withCheckpoint) onCheckpointRef.current?.();
  };

  // Mount once. Every callback is read through a ref so the view is never rebuilt.
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return undefined;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          syntaxHighlighting(uniworkHighlightStyle),
          html(),
          search(),
          autocompletion(),
          cmPlaceholder(placeholder ?? ""),
          // No `history()` / `historyKeymap` here on purpose: the shared
          // source surface owns undo through the editor handle's snapshot
          // stack (`SourceEditor.history`), and CodeMirror's `runHandlers`
          // calls `preventDefault()` but never `stopPropagation()`, so a
          // second in-pane history would let one Mod-Z run BOTH undo systems
          // (CM undo fires onChange -> adapter `setText` pushes `past`, then
          // the bubbled section handler pops it straight back). One owner,
          // exactly one undo per keystroke.
          keymap.of([...defaultKeymap, ...searchKeymap]),
          uniworkTheme,
          readOnlyCompartment.of(readOnlyExtensions(readOnly)),
          ariaLabelCompartment.of(ariaLabelExtension(ariaLabel)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(externalSync))) return;
            // Skip edits that land while an IME composition is live; they are
            // reported once, on the compositionend transition below.
            if (composingRef.current || update.view.composing) {
              composedChangeRef.current = true;
              return;
            }
            emitChange(update.state.doc.toString(), true);
          }),
        ],
      }),
    });
    viewRef.current = view;
    const dom = view.contentDOM;
    const onCompositionStart = () => { composingRef.current = true; };
    const onCompositionEnd = () => {
      composingRef.current = false;
      if (!composedChangeRef.current) return;
      composedChangeRef.current = false;
      emitChange(view.state.doc.toString(), true);
    };
    // A cancelled composition without a trailing compositionend would leave
    // composingRef stuck true, swallowing every later edit. Clear both refs
    // and flush a pending change so the text is never silently unsaved.
    const onCompositionCancel = () => {
      composingRef.current = false;
      if (!composedChangeRef.current) return;
      composedChangeRef.current = false;
      emitChange(view.state.doc.toString(), true);
    };
    dom.addEventListener("compositionstart", onCompositionStart);
    dom.addEventListener("compositionend", onCompositionEnd);
    dom.addEventListener("compositioncancel", onCompositionCancel);
    return () => {
      dom.removeEventListener("compositionstart", onCompositionStart);
      dom.removeEventListener("compositionend", onCompositionEnd);
      dom.removeEventListener("compositioncancel", onCompositionCancel);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by contract
  }, []);

  // Controlled value: replace the doc only when it actually differs, so a
  // round-trip through onChange does not loop.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value }, annotations: externalSync.of(true) });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: ariaLabelCompartment.reconfigure(ariaLabelExtension(ariaLabel)) });
  }, [ariaLabel]);

  // The accessible name lives on `.cm-content` via ariaLabelCompartment; a
  // label here would sit on a generic div and be ignored by AT.
  return <div ref={containerRef} className={className} data-testid="html-codemirror" />;
}
