"use client";

import type { ReactNode } from "react";
import { Goal, RotateCcwClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FeedKindMark } from "./feed-filter-chips";

export interface ComposerSuggestion {
  label: string;
  question: string;
  icon: ReactNode;
}

const PLAIN_ICON = "size-4 text-muted-foreground";

/**
 * What the composer offers to ask: about what happened so far once the feed has
 * entries, else about the meeting before and this one's goal.
 */
export function useMeetingSuggestions(hasItems: boolean): ComposerSuggestion[] {
  const { t } = useTranslation(undefined, { keyPrefix: "meetings.panel.suggest" });
  return hasItems
    ? [
        { label: t("last5"), question: t("last5Q"), icon: <RotateCcwClock aria-hidden className={PLAIN_ICON} /> },
        { label: t("decided"), question: t("decidedQ"), icon: <FeedKindMark kind="decision" size="chip" /> },
        { label: t("mine"), question: t("mineQ"), icon: <FeedKindMark kind="task" size="chip" /> },
      ]
    : [
        { label: t("lastTime"), question: t("lastTimeQ"), icon: <RotateCcwClock aria-hidden className={PLAIN_ICON} /> },
        { label: t("goal"), question: t("goalQ"), icon: <Goal aria-hidden className={PLAIN_ICON} /> },
      ];
}

/** One-tap questions over the composer; a pick is asked at once. */
export function ComposerSuggestions({ items, onPick }: { items: ComposerSuggestion[]; onPick: (question: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {items.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onPick(s.question)}
          className="inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-full bg-surface-hover pr-3 pl-2 text-caption font-medium text-foreground transition-colors hover:bg-surface-selected pointer-coarse:h-11"
        >
          {s.icon}
          {s.label}
        </button>
      ))}
    </div>
  );
}
