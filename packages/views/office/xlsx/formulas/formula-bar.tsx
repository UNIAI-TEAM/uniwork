"use client";

// Wave A / A8 (UNI-926): the formula bar. It owns the caret and the hint
// popup so `xlsx-editor.tsx` only mounts it and keeps its own draft state
// (the draft is also read by the paste/commit paths). The input carries
// combobox semantics; the hint list is a plain listbox under the bar.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { XlsxFormulaHintsList, useFormulaHints } from "./formula-hints";

export interface XlsxFormulaBarProps {
  /** The live draft; the editor owns it (paste and commit read it too). */
  value: string;
  /** The input is disabled (read-only or no selection). */
  disabled?: boolean;
  /** A new draft from typing or from a hint completion. */
  onChange: (value: string) => void;
  /** Enter, or a blur that still holds an uncommitted draft: the editor
   *  commits the draft. A blur that follows a commit (for example the click
   *  that moves the selection) is ignored, so stale text is never written to
   *  the next cell. */
  onCommit: () => void;
}

export function XlsxFormulaBar({ value, disabled = false, onChange, onCommit }: XlsxFormulaBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);

  // F1 (UNI-926): the bar must commit a draft at most once. After Enter the
  // editor has written the cell, but the input keeps its text and focus; the
  // click that then changes the selection blurs the input, and a second
  // commit would write the stale text into the newly selected cell. Track the
  // uncommitted state here and drop it as soon as the draft is committed or
  // the editor refreshes the draft for another cell.
  const dirtyRef = useRef(false);
  const emittedRef = useRef<string | null>(null);

  // Completing a name rewrites the draft and puts the caret after the "(".
  // The caret state updates immediately (the hints close because the token is
  // gone); the DOM selection is restored after the new value has committed.
  const pendingSelectionRef = useRef<number | null>(null);
  const emit = useCallback(
    (nextValue: string) => {
      // Our own edit: uncommitted until Enter (or a blur that is not a
      // selection change) commits it.
      emittedRef.current = nextValue;
      dirtyRef.current = true;
      onChange(nextValue);
    },
    [onChange],
  );
  const complete = useCallback(
    (nextValue: string, nextCaret: number) => {
      emit(nextValue);
      setCaret(nextCaret);
      pendingSelectionRef.current = nextCaret;
    },
    [emit],
  );
  useEffect(() => {
    const pending = pendingSelectionRef.current;
    if (pending === null) return;
    pendingSelectionRef.current = null;
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(pending, pending);
  });
  // The editor's draft changing to a value we did not just emit means the
  // selection moved (or paste/reload refreshed the cell): adopt it and clear
  // the pending commit so the old text cannot follow the caret.
  useEffect(() => {
    if (emittedRef.current !== null && value === emittedRef.current) {
      emittedRef.current = null;
      return;
    }
    emittedRef.current = null;
    dirtyRef.current = false;
  }, [value]);
  const commit = useCallback(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    onCommit();
  }, [onCommit]);
  // The catalog is static, so hints are available wherever editing is: the
  // live grid and the snapshot-table fallback alike.
  const hints = useFormulaHints({ draft: value, caret, enabled: !disabled, onComplete: complete });

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/10 px-3 py-2">
      <label htmlFor="xlsx-formula-bar" className="text-caption font-medium">
        {t("office.xlsx.formula.label")}
      </label>
      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          ref={inputRef}
          id="xlsx-formula-bar"
          value={value}
          disabled={disabled}
          role={hints.inputProps.role}
          aria-autocomplete={hints.inputProps["aria-autocomplete"]}
          aria-expanded={hints.inputProps["aria-expanded"]}
          aria-controls={hints.inputProps["aria-controls"]}
          aria-activedescendant={hints.inputProps["aria-activedescendant"]}
          onChange={(event) => {
            emit(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={(event) => {
            if (hints.handleKeyDown(event)) return;
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          onBlur={() => {
            hints.dismiss();
            commit();
          }}
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 font-sans text-caption pointer-coarse:min-h-11"
          data-testid="xlsx-formula-bar"
          aria-label={t("office.xlsx.formula.label")}
        />
        {hints.open ? (
          <XlsxFormulaHintsList items={hints.items} activeIndex={hints.activeIndex} onSelect={hints.select} />
        ) : null}
      </div>
    </div>
  );
}