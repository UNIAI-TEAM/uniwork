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
  /** Enter or blur: the editor commits the draft. */
  onCommit: () => void;
}

export function XlsxFormulaBar({ value, disabled = false, onChange, onCommit }: XlsxFormulaBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);

  // Completing a name rewrites the draft and puts the caret after the "(".
  // The caret state updates immediately (the hints close because the token is
  // gone); the DOM selection is restored after the new value has committed.
  const pendingSelectionRef = useRef<number | null>(null);
  const complete = useCallback(
    (nextValue: string, nextCaret: number) => {
      onChange(nextValue);
      setCaret(nextCaret);
      pendingSelectionRef.current = nextCaret;
    },
    [onChange],
  );
  useEffect(() => {
    const pending = pendingSelectionRef.current;
    if (pending === null) return;
    pendingSelectionRef.current = null;
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(pending, pending);
  });
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
            onChange(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={(event) => {
            if (hints.handleKeyDown(event)) return;
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit();
            }
          }}
          onBlur={() => {
            hints.dismiss();
            onCommit();
          }}
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 font-mono text-caption pointer-coarse:min-h-11"
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
