"use client";

// Wave A / A8 (UNI-926): the formula-bar function hints. While the formula
// draft is a formula and the caret sits inside a function-name token, a small
// list of matching catalog functions appears under the bar. Arrow keys move,
// Enter/Tab completes the name and keeps focus in the input, Escape closes.
// The editor owns the draft; this module owns the matching, the active row and
// the keyboard rule so the editor diff stays a mount plus a few props.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { completeFunctionName, functionTokenAt, type XlsxFunctionToken } from "./hint-match";
import { matchFunctions, type XlsxFunctionSpec } from "./function-catalog";

/** The id the input's `aria-controls` points at. */
export const XLSX_FORMULA_HINTS_LIST_ID = "xlsx-formula-hints";

/** Rows the popup shows at once; the list scrolls beyond this. */
export const XLSX_FORMULA_HINTS_MAX = 8;

export interface XlsxFormulaHintsController {
  /** The popup is showing rows. */
  readonly open: boolean;
  readonly items: readonly XlsxFunctionSpec[];
  readonly activeIndex: number;
  /** Spread onto the formula input (combobox semantics). */
  readonly inputProps: {
    readonly role: "combobox";
    readonly "aria-autocomplete": "list";
    readonly "aria-expanded": boolean;
    readonly "aria-controls": string;
    readonly "aria-activedescendant": string | undefined;
  };
  /** Formula-input keydown; true when the hint list consumed the event. */
  handleKeyDown: (event: { key: string; preventDefault: () => void }) => boolean;
  /** Pick a row with the pointer; completes and keeps the input focused. */
  select: (index: number) => void;
  /** Close without completing (Escape, blur). */
  dismiss: () => void;
}

export interface XlsxFormulaHintsOptions {
  /** The live formula-bar text. */
  draft: string;
  /** The input caret (0-based). */
  caret: number;
  /** Hints are off in read-only mounts and without a selection. */
  enabled?: boolean;
  /** Applies the completed draft; the caller restores the caret and focus. */
  onComplete: (value: string, caret: number) => void;
}

/** The id of one row, shared by the option element and `aria-activedescendant`. */
export const formulaHintOptionId = (name: string): string => `${XLSX_FORMULA_HINTS_LIST_ID}-${name}`;

/**
 * The formula-hint rule set, as a hook the editor mounts next to its formula
 * input. The token is derived from the draft + caret; the list is the catalog
 * filtered by the typed prefix (case-insensitive), bounded to a readable popup.
 */
export function useFormulaHints({
  draft,
  caret,
  enabled = true,
  onComplete,
}: XlsxFormulaHintsOptions): XlsxFormulaHintsController {
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const token: XlsxFunctionToken | null = useMemo(
    () => (enabled ? functionTokenAt(draft, caret) : null),
    [caret, draft, enabled],
  );
  const items = useMemo(
    () => (token ? matchFunctions(token.prefix).slice(0, XLSX_FORMULA_HINTS_MAX) : []),
    [token],
  );
  // A new token (a different typed prefix) re-opens and re-arms the first row.
  const tokenKey = token ? `${token.start}:${token.prefix}` : null;
  const lastTokenKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (tokenKey === lastTokenKeyRef.current) return;
    lastTokenKeyRef.current = tokenKey;
    setDismissed(false);
    setActiveIndex(0);
  }, [tokenKey]);

  const open = token !== null && items.length > 0 && !dismissed;
  const boundedIndex = items.length === 0 ? 0 : Math.min(Math.max(activeIndex, 0), items.length - 1);

  const complete = useCallback(
    (index: number) => {
      const spec = items[index];
      if (!token || !spec) return;
      const completed = completeFunctionName(draft, token, spec.name);
      onComplete(completed.value, completed.caret);
    },
    [draft, items, onComplete, token],
  );

  const handleKeyDown = useCallback(
    (event: { key: string; preventDefault: () => void }): boolean => {
      if (!open) return false;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((current) => (current + 1) % items.length);
          return true;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex((current) => (current - 1 + items.length) % items.length);
          return true;
        case "Enter":
        case "Tab":
          event.preventDefault();
          complete(boundedIndex);
          return true;
        case "Escape":
          event.preventDefault();
          setDismissed(true);
          return true;
        default:
          return false;
      }
    },
    [boundedIndex, complete, items.length, open],
  );

  const activeOptionId = open && items[boundedIndex] ? formulaHintOptionId(items[boundedIndex]!.name) : undefined;

  return {
    open,
    items,
    activeIndex: boundedIndex,
    inputProps: {
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": open,
      "aria-controls": XLSX_FORMULA_HINTS_LIST_ID,
      "aria-activedescendant": activeOptionId,
    },
    handleKeyDown,
    select: complete,
    dismiss: () => setDismissed(true),
  };
}

/** The hint popup: name, signature and the localized one-line description per
 *  row. Purely presentational; the hook above owns the state. */
export function XlsxFormulaHintsList({
  items,
  activeIndex,
  onSelect,
}: {
  items: readonly XlsxFunctionSpec[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div
      id={XLSX_FORMULA_HINTS_LIST_ID}
      role="listbox"
      aria-label={t("office.xlsx.formulas.hints.label")}
      data-testid="xlsx-formula-hints"
      className="absolute top-full left-0 z-50 mt-1 max-h-64 w-96 max-w-[min(24rem,90vw)] overflow-y-auto rounded-control border border-border bg-surface-raised py-1 shadow-[var(--menu-shadow)]"
    >
      {items.map((spec, index) => (
        <div
          key={spec.name}
          id={formulaHintOptionId(spec.name)}
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={-1}
          data-testid={`xlsx-formula-hint-${spec.name}`}
          className={cn("cursor-default px-2 py-1", index === activeIndex && "bg-accent text-accent-foreground")}
          onMouseDown={(event) => {
            // Keep focus in the input: the pick must not blur the formula bar.
            event.preventDefault();
            onSelect(index);
          }}
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-caption font-semibold">{spec.name}</span>
            <span className="min-w-0 truncate text-caption text-muted-foreground">{spec.signature}</span>
          </div>
          <p className="truncate text-caption text-muted-foreground">{t(spec.descriptionKey)}</p>
        </div>
      ))}
    </div>
  );
}