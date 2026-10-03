"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { CaseSensitive, ChevronDown, ChevronUp, WholeWord, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import { cn } from "@uniwork/ui/lib/utils";
import { applyDocxFindHighlight, clearDocxFindHighlight, mountDocxFindHighlight } from "./find-decoration";
import {
  clampMatchIndex,
  DEFAULT_FIND_OPTIONS,
  DOCX_FIND_REPLACE_META,
  findMatches,
  replaceMatches,
  revealMatch,
  stepMatchIndex,
  type FindMatch,
  type FindOptions,
} from "./find-state";

export interface DocxFindPanelProps {
  /** The live editor the panel searches. Null disables the inputs while the
   * host surface is not mounted yet. */
  editor: Editor | null;
  /** The host owns visibility: Escape and the close button call this. */
  onClose: () => void;
  /** A read-only document keeps the replace controls visible but disabled. */
  readOnly?: boolean;
  className?: string;
}

/**
 * Find & replace over the DOCX TipTap surface: search UI, match state and the
 * highlight updates. A document editor already carries the plugin from the
 * schema extension (the mount below is a no-op there); a bare editor gets it
 * from the panel. It never touches the save path.
 */
export function DocxFindPanel({ editor, onClose, readOnly = false, className }: DocxFindPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState<FindOptions>(DEFAULT_FIND_OPTIONS);
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ query, options, activeIndex });
  useEffect(() => {
    latest.current = { query, options, activeIndex };
  });

  const canReplace = Boolean(editor && !editor.isDestroyed && editor.isEditable && !readOnly);

  const runSearch = useCallback(
    (nextQuery: string, nextOptions: FindOptions, keepIndex: number | null): { found: FindMatch[]; index: number } => {
      if (!editor || editor.isDestroyed) {
        setMatches([]);
        setActiveIndex(0);
        return { found: [], index: 0 };
      }
      const found = findMatches(editor, nextQuery, nextOptions);
      const index = keepIndex === null ? 0 : clampMatchIndex(keepIndex, found.length);
      setMatches(found);
      setActiveIndex(index);
      applyDocxFindHighlight(editor, found, index);
      return { found, index };
    },
    [editor],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    return mountDocxFindHighlight(editor);
  }, [editor]);

  useEffect(() => {
    const { found, index } = runSearch(query, options, null);
    const active = found[index];
    if (editor && !editor.isDestroyed && active) revealMatch(editor, active);
  }, [editor, runSearch, query, options]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const onUpdate = (event: { transaction: Transaction }) => {
      // A replace dispatch re-runs the search in the click handler itself;
      // skipping its rescan here keeps one scan per replace instead of two.
      if (event.transaction.getMeta(DOCX_FIND_REPLACE_META)) return;
      // Any other document edit invalidates both the match set and the status.
      setReplacedCount(null);
      const current = latest.current;
      runSearch(current.query, current.options, current.activeIndex);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, runSearch]);

  useEffect(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  const close = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      clearDocxFindHighlight(editor);
      // Word hands focus back to the document when Find closes.
      editor.commands.focus();
    }
    onClose();
  }, [editor, onClose]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!editor || editor.isDestroyed || matches.length === 0) return;
      const next = stepMatchIndex(activeIndex, matches.length, direction);
      const match = matches[next];
      if (!match) return;
      setActiveIndex(next);
      setReplacedCount(null);
      applyDocxFindHighlight(editor, matches, next);
      revealMatch(editor, match);
    },
    [editor, matches, activeIndex],
  );

  const replaceCurrent = useCallback(() => {
    if (!editor || editor.isDestroyed || !canReplace) return;
    const target = matches[activeIndex];
    if (!target) return;
    const count = replaceMatches(editor, [target], replacement);
    setReplacedCount(count);
    const { found, index } = runSearch(query, options, activeIndex);
    const active = found[index];
    if (active) revealMatch(editor, active);
  }, [editor, canReplace, matches, activeIndex, replacement, runSearch, query, options]);

  const replaceAll = useCallback(() => {
    if (!editor || editor.isDestroyed || !canReplace || matches.length === 0) return;
    const count = replaceMatches(editor, matches, replacement);
    setReplacedCount(count);
    runSearch(query, options, 0);
  }, [editor, canReplace, matches, replacement, runSearch, query, options]);

  const countLabel =
    query.length === 0
      ? t("office.docx.find.noQuery")
      : matches.length === 0
        ? t("office.docx.find.noMatches")
        : t("office.docx.find.matchCount", { current: activeIndex + 1, total: matches.length });
  const status = replacedCount === null ? null : t("office.docx.find.replaced", { count: replacedCount });

  return (
    <div
      ref={rootRef}
      role="search"
      aria-label={t("office.docx.find.label")}
      data-testid="docx-find-panel"
      className={cn(
        "absolute end-3 top-3 z-30 w-[min(24rem,calc(100vw-1.5rem))] rounded-lg bg-surface-raised p-2 text-popover-foreground shadow-[var(--menu-shadow)] ring-1 ring-surface-border",
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <Input
          ref={searchRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setReplacedCount(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }}
          placeholder={t("office.docx.find.searchPlaceholder")}
          aria-label={t("office.docx.find.searchLabel")}
          disabled={!editor}
          data-testid="docx-find-input"
          className="h-8 min-w-0 flex-1"
        />
        <Toggle
          type="button"
          pressed={options.matchCase}
          onPressedChange={(pressed) => {
            setOptions((current) => ({ ...current, matchCase: pressed }));
            setReplacedCount(null);
          }}
          variant="toolbar"
          size="sm"
          disabled={!editor}
          aria-label={t("office.docx.find.matchCase")}
          data-testid="docx-find-match-case"
        >
          <CaseSensitive aria-hidden />
        </Toggle>
        <Toggle
          type="button"
          pressed={options.wholeWord}
          onPressedChange={(pressed) => {
            setOptions((current) => ({ ...current, wholeWord: pressed }));
            setReplacedCount(null);
          }}
          variant="toolbar"
          size="sm"
          disabled={!editor}
          aria-label={t("office.docx.find.wholeWord")}
          data-testid="docx-find-whole-word"
        >
          <WholeWord aria-hidden />
        </Toggle>
        <span
          className="min-w-14 shrink-0 text-center text-caption text-muted-foreground tabular-nums"
          aria-live="polite"
          data-testid="docx-find-count"
        >
          {countLabel}
        </span>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.docx.find.previous")}
          disabled={matches.length === 0}
          onClick={() => step(-1)}
          data-testid="docx-find-previous"
        >
          <ChevronUp aria-hidden />
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.docx.find.next")}
          disabled={matches.length === 0}
          onClick={() => step(1)}
          data-testid="docx-find-next"
        >
          <ChevronDown aria-hidden />
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.docx.find.close")}
          onClick={close}
          data-testid="docx-find-close"
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <Input
          value={replacement}
          onChange={(event) => {
            setReplacement(event.target.value);
            setReplacedCount(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            replaceCurrent();
          }}
          placeholder={t("office.docx.find.replacePlaceholder")}
          aria-label={t("office.docx.find.replaceLabel")}
          disabled={!canReplace}
          data-testid="docx-find-replace-input"
          className="h-8 min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canReplace || matches.length === 0}
          onClick={replaceCurrent}
          data-testid="docx-find-replace"
        >
          {t("office.docx.find.replace")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canReplace || matches.length === 0}
          onClick={replaceAll}
          data-testid="docx-find-replace-all"
        >
          {t("office.docx.find.replaceAll")}
        </Button>
      </div>
      <p
        className="mt-1 min-h-4 text-caption text-muted-foreground"
        role="status"
        data-testid="docx-find-status"
      >
        {status}
      </p>
    </div>
  );
}
