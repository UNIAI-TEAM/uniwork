"use client";

import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMentionCandidate } from "./chat-mention-utils";

export function ChatMentionAutocomplete({
  candidates,
  selectedIndex,
  onSelect,
  onHover,
}: {
  candidates: ChatMentionCandidate[];
  selectedIndex: number;
  onSelect: (candidate: ChatMentionCandidate) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useTranslation();

  if (candidates.length === 0) {
    return (
      <div
        role="listbox"
        aria-label={t("chat.mention_picker_label")}
        className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm rounded-lg border border-border bg-surface p-2 shadow-lg"
      >
        <p className="px-2 py-1.5 text-caption text-muted-foreground">{t("chat.mention_no_results")}</p>
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label={t("chat.mention_picker_label")}
      className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
    >
      {candidates.map((candidate, index) => {
        const selected = index === selectedIndex;
        const isAll = candidate.kind === "all";
        const initials = isAll
          ? "@"
          : candidate.label.trim().slice(0, 1).toUpperCase() || "?";

        return (
          <button
            key={isAll ? "all" : candidate.userId}
            type="button"
            role="option"
            aria-selected={selected}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-body",
              "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
              selected && "bg-muted",
            )}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(candidate);
            }}
          >
            {isAll ? (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Users className="size-4 text-primary" aria-hidden />
              </span>
            ) : (
              <ActorAvatar name={candidate.label} initials={initials} size="sm" className="shrink-0" />
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
