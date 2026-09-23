"use client";

import { Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import { initialOf } from "./chat-initials";

/** The DOM id of one option, so the composer can point aria-activedescendant at it. */
export function mentionOptionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`;
}

export function ChatMentionAutocomplete({
  listId,
  candidates,
  selectedIndex,
  onSelect,
  onHover,
}: {
  listId: string;
  candidates: ChatMentionCandidate[];
  selectedIndex: number;
  onSelect: (candidate: ChatMentionCandidate) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  // Arrow keys move the active option from the textarea; keep it in view.
  useEffect(() => {
    if (!listRef.current) return;
    document.getElementById(mentionOptionId(listId, selectedIndex))?.scrollIntoView?.({ block: "nearest" });
  }, [listId, selectedIndex]);

  // No options is a message, not an empty list: a listbox with nothing in it
  // reads as broken.
  if (candidates.length === 0) {
    return (
      <div
        role="status"
        className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm rounded-lg bg-surface-raised p-2 shadow-[var(--menu-shadow)] ring-1 ring-surface-border"
      >
        <p className="px-2 py-1.5 text-caption text-muted-foreground">{t("chat.mention_no_results")}</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={t("chat.mention_picker_label")}
      className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-full max-w-sm overflow-y-auto rounded-lg bg-surface-raised p-1 shadow-[var(--menu-shadow)] ring-1 ring-surface-border"
    >
      {candidates.map((candidate, index) => {
        const selected = index === selectedIndex;
        const isAll = candidate.kind === "all";
        const initials = isAll ? "@" : initialOf(candidate.label);

        return (
          <button
            key={isAll ? "all" : candidate.userId}
            id={mentionOptionId(listId, index)}
            type="button"
            role="option"
            aria-selected={selected}
            tabIndex={-1}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-body pointer-coarse:min-h-11",
              "hover:bg-surface-hover",
              selected && "bg-surface-selected hover:bg-surface-selected",
            )}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(candidate);
            }}
          >
            {isAll ? (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand-subtle-foreground">
                <Users className="size-4" aria-hidden />
              </span>
            ) : (
              <ActorAvatar name={candidate.label} initials={initials} size="lg" className="shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{candidate.label}</span>
              {!isAll && candidate.email ? (
                <span className="block truncate text-caption text-muted-foreground">{candidate.email}</span>
              ) : isAll ? (
                <span className="block truncate text-caption text-muted-foreground">
                  {t("chat.mention_all_hint")}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
