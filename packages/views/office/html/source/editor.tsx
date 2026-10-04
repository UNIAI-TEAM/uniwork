"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, placeholder as cmPlaceholder } from "@codemirror/view";
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

function readOnlyExtensions(readOnly: boolean) {
  return [EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)];
}

export function HtmlSourceEditor({ value, readOnly = false, onChange, onCheckpoint, className, ariaLabel, placeholder }: HtmlSourceEditorProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCheckpointRef = useRef(onCheckpoint);
  onChangeRef.current = onChange;
  onCheckpointRef.current = onCheckpoint;

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
          history(),
          drawSelection(),
          highlightActiveLine(),
          syntaxHighlighting(uniworkHighlightStyle),
          html(),
          search(),
          cmPlaceholder(placeholder ?? ""),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          uniworkTheme,
          readOnlyCompartment.of(readOnlyExtensions(readOnly)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            // `composing` is true while an IME composition is live: skip the
            // edit then, and fire once on the composing -> false transition.
            if (update.view.composing) return;
            const next = update.state.doc.toString();
            onChangeRef.current(next);
            onCheckpointRef.current?.();
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
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
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)) });
  }, [readOnly]);

  return <div ref={containerRef} className={className} data-testid="html-codemirror" aria-label={ariaLabel} />;
}
