"use client";

import type { KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isImeComposing } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import type { TaskFindState } from "./use-task-find";

/**
 * Floating find bar for the task detail page. Presentational: search state,
 * highlighting and scrolling live in `useTaskFind`, which also focuses the
 * input on every open. Rendered only while `find.open`. `data-find-ignore`
 * keeps the bar's own text out of the match walk.
 */
export function TaskFindBar({
  find,
  className,
}: {
  find: TaskFindState;
  className?: string;
}) {
  const { t } = useTranslation();
  const {
    query,
    matchCount,
    activeIndex,
    pending,
    setQuery,
    closeFind,
    goNext,
    goPrev,
    inputRef,
    barRef,
  } = find;

  const hasQuery = query.trim().length > 0;
  const noMatches = matchCount === 0;
  // While a new query waits for its walk, say nothing rather than flash
  // "no matches" for text that is on the page.
  const countLabel =
    !hasQuery || (pending && noMatches)
      ? ""
      : noMatches
        ? t("tasks.detail.find.no_matches")
        : t("tasks.detail.find.position", { current: activeIndex + 1, total: matchCount });
  // Stepping flushes a pending walk, so it stays available while one waits.
  const cannotStep = noMatches && !pending;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // A Vietnamese IME confirms a syllable with Enter; that is not "next match".
    if (isImeComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) goPrev();
      else goNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFind();
    }
  };

  return (
    <div
      ref={barRef}
      data-find-ignore
      role="search"
      className={cn(
        "flex items-center gap-1 rounded-lg border border-border bg-popover p-1 pl-2 shadow-md",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("tasks.detail.find.placeholder")}
        aria-label={t("tasks.detail.find.label")}
        className="h-7 w-44 border-0 bg-transparent px-1 shadow-none dark:bg-transparent"
      />
      <span
        aria-live="polite"
        data-testid="task-find-count"
        className="min-w-14 shrink-0 whitespace-nowrap text-right text-caption tabular-nums text-muted-foreground"
      >
        {countLabel}
      </span>
      <div className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-disabled={cannotStep || undefined}
          onClick={goPrev}
          aria-label={t("tasks.detail.find.previous")}
          title={t("tasks.detail.find.previous")}
        >
          <ChevronUp aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-disabled={cannotStep || undefined}
          onClick={goNext}
          aria-label={t("tasks.detail.find.next")}
          title={t("tasks.detail.find.next")}
        >
          <ChevronDown aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={closeFind}
          aria-label={t("tasks.detail.find.close")}
          title={t("tasks.detail.find.close")}
        >
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}
