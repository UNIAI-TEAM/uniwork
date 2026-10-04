"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Replace, ReplaceAll, WholeWord } from "lucide-react";
import { isImeComposing } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import { findMatches, type FindMatch, type FindQuery, type FindReplaceEdit, type FindResult } from "./matcher";

export interface FindReplacePanelHandle {
  /** Focus the find field; the consumer calls this from its Ctrl+F handler. */
  focus: () => void;
}

export interface FindReplacePanelProps {
  /** The text to search. The panel never owns it - the caller does. */
  text: string;
  /** Rendered when true (default). Ctrl+F/Ctrl+H live in the consumer. */
  open?: boolean;
  disabled?: boolean;
  className?: string;
  /** Replacement string. Controlled when supplied, else internal. */
  replaceValue?: string;
  defaultReplaceValue?: string;
  onReplaceValueChange?: (value: string) => void;
  onClose?: () => void;
  /**
   * Replace one match. The caller applies the edit to its own document and
   * passes the new text back; the panel re-runs the matcher on it.
   */
  onReplace?: (edit: FindReplaceEdit, index: number) => void;
  /** Replace every match at once. */
  onReplaceAll?: (edits: readonly FindReplaceEdit[]) => void;
  /** The active match, or null when there is none. For scroll/highlight. */
  onActiveMatchChange?: (match: FindMatch | null, index: number) => void;
  /**
   * The live query and flag set, reported whenever the query, a flag or the
   * searched `text` changes. The panel still owns the input state; this is a
   * read-only mirror for a host that highlights matches it draws itself (e.g.
   * a ProseMirror decoration).
   */
  onQueryChange?: (query: FindQuery) => void;
  /**
   * The full match result for the current query, reported whenever the query,
   * a flag or the searched `text` changes. Same read-only mirror contract as
   * `onQueryChange`: the host owns the document and asks for the ranges.
   */
  onResultChange?: (result: FindResult) => void;
  ref?: Ref<FindReplacePanelHandle>;
}

/** The one find/replace surface shared by textarea, TipTap and CodeMirror. */
export function FindReplacePanel({
  text,
  open = true,
  disabled = false,
  className,
  replaceValue,
  defaultReplaceValue = "",
  onReplaceValueChange,
  onClose,
  onReplace,
  onReplaceAll,
  onActiveMatchChange,
  onQueryChange,
  onResultChange,
  ref,
}: FindReplacePanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.common.find" });
  const [query, setQuery] = useState("");
  const [innerReplace, setInnerReplace] = useState(defaultReplaceValue);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const replace = replaceValue ?? innerReplace;

  useImperativeHandle(ref, () => ({
    focus: () => requestAnimationFrame(() => inputRef.current?.focus()),
  }));

  const result = useMemo(
    () => findMatches({ text, query, caseSensitive, wholeWord, regex }),
    [text, query, caseSensitive, wholeWord, regex],
  );
  const { count, invalidPattern } = result;

  // A new query or flag set restarts the walk at the first match; a text change
  // (an applied replacement) only clamps the cursor, so "replace" keeps place.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, caseSensitive, wholeWord, regex]);
  const safeIndex = count > 0 ? Math.min(Math.max(activeIndex, 0), count - 1) : -1;
  const activeMatch = safeIndex >= 0 ? result.matches[safeIndex]! : null;
  // Read through a ref: an inline arrow from the caller must not re-fire the
  // report on every render, and it is not a dependency of the walk itself.
  const reportActiveRef = useRef(onActiveMatchChange);
  reportActiveRef.current = onActiveMatchChange;
  useEffect(() => {
    reportActiveRef.current?.(activeMatch, safeIndex);
  }, [activeMatch, safeIndex]);

  // Same ref pattern as the active-match report: an inline arrow from the host
  // must not re-fire the report on every render.
  const reportQueryRef = useRef(onQueryChange);
  reportQueryRef.current = onQueryChange;
  useEffect(() => {
    reportQueryRef.current?.({ text, query, caseSensitive, wholeWord, regex });
  }, [text, query, caseSensitive, wholeWord, regex]);

  const reportResultRef = useRef(onResultChange);
  reportResultRef.current = onResultChange;
  useEffect(() => {
    reportResultRef.current?.(result);
  }, [result]);

  const setReplacement = useCallback((value: string) => {
    if (replaceValue === undefined) setInnerReplace(value);
    onReplaceValueChange?.(value);
  }, [onReplaceValueChange, replaceValue]);
  const step = useCallback((delta: number) => {
    setActiveIndex((index) => {
      if (count === 0) return -1;
      const from = Math.min(Math.max(index, 0), count - 1);
      return (from + delta + count) % count;
    });
  }, [count]);
  const replaceCurrent = useCallback(() => {
    if (!activeMatch) return;
    onReplace?.({ start: activeMatch.start, end: activeMatch.end, replacement: replace }, safeIndex);
  }, [activeMatch, onReplace, replace, safeIndex]);
  const replaceEvery = useCallback(() => {
    if (count === 0) return;
    onReplaceAll?.(result.matches.map((match) => ({ start: match.start, end: match.end, replacement: replace })));
  }, [count, onReplaceAll, replace, result.matches]);

  // Escape closes from either field. A Vietnamese IME confirms a syllable with
  // Enter, so that Enter is never a command.
  const closeOnEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape" && onClose) {
      event.preventDefault();
      onClose();
    }
  };
  // In the find field Enter steps (Shift+Enter steps back); in the replace field
  // Enter replaces the current match once, as every editor does.
  const onFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    closeOnEscape(event);
  };
  const onReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      replaceCurrent();
      return;
    }
    closeOnEscape(event);
  };
  const hasQuery = query.length > 0;
  const cannotStep = disabled || invalidPattern || count === 0;
  const counter = invalidPattern
    ? t("invalidPattern", { defaultValue: "Invalid pattern" })
    : !hasQuery
      ? ""
      : count === 0
        ? t("noMatches")
        : t("matchCount", { count });

  if (!open) return null;

  return (
    <div
      role="search"
      aria-label={t("title")}
      data-testid="find-replace-panel"
      className={cn("flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-popover p-1.5 shadow-md", className)}
    >
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("findPlaceholder")}
        aria-label={t("findPlaceholder")}
        aria-invalid={invalidPattern || undefined}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onKeyDown={onFindKeyDown}
        className="h-7 w-40"
        data-testid="find-replace-query"
      />
      <span
        aria-live="polite"
        data-testid="find-replace-count"
        className={cn(
          "min-w-16 shrink-0 whitespace-nowrap px-1 text-right text-caption tabular-nums",
          invalidPattern ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {counter}
      </span>
      <span className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("previous")}
          title={t("previous")}
          aria-disabled={cannotStep || undefined}
          onClick={() => step(-1)}
        >
          <ChevronUp aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("next")}
          title={t("next")}
          aria-disabled={cannotStep || undefined}
          onClick={() => step(1)}
        >
          <ChevronDown aria-hidden />
        </Button>
      </span>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <Input
        value={replace}
        onChange={(event) => setReplacement(event.target.value)}
        placeholder={t("replacePlaceholder")}
        aria-label={t("replacePlaceholder")}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onKeyDown={onReplaceKeyDown}
        className="h-7 w-40"
        data-testid="find-replace-value"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("replace")}
        aria-disabled={cannotStep || undefined}
        onClick={replaceCurrent}
        data-testid="find-replace-one"
      >
        <Replace aria-hidden />
        {t("replace")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("replaceAll")}
        aria-disabled={cannotStep || undefined}
        onClick={replaceEvery}
        data-testid="find-replace-all"
      >
        <ReplaceAll aria-hidden />
        {t("replaceAll")}
      </Button>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <Label className="text-caption text-muted-foreground">
        <Checkbox checked={caseSensitive} onCheckedChange={(value) => setCaseSensitive(value === true)} disabled={disabled} />
        <CaseSensitive aria-hidden className="size-3.5" />
        <span>{t("caseSensitive")}</span>
      </Label>
      <Label className="text-caption text-muted-foreground">
        <Checkbox checked={wholeWord} onCheckedChange={(value) => setWholeWord(value === true)} disabled={disabled} />
        <WholeWord aria-hidden className="size-3.5" />
        <span>{t("wholeWord")}</span>
      </Label>
      <Label className="text-caption text-muted-foreground">
        <Checkbox checked={regex} onCheckedChange={(value) => setRegex(value === true)} disabled={disabled} />
        <Regex aria-hidden className="size-3.5" />
        <span>{t("regex")}</span>
      </Label>
    </div>
  );
}
