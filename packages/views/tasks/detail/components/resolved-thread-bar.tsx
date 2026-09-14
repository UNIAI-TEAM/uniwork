"use client";

import { ChevronDown, ChevronRight, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

/** A resolved thread collapses to one line so the open ones stay readable. */
export function ResolvedThreadBar({
  replyCount,
  expanded,
  onToggle,
}: {
  replyCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      data-testid="resolved-thread-bar"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground"
    >
      <Chevron className="size-3.5 shrink-0" aria-hidden />
      <CircleCheck className="size-3.5 shrink-0" aria-hidden />
      <span>{t("tasks.detail.thread_resolved", { count: replyCount })}</span>
    </button>
  );
}
