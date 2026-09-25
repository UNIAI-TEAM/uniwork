"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { initialOf } from "./chat-initials";

/**
 * People picked so far, each removable. `summary` is a plain-words count
 * ("2 selected · at least 2 needed") shown next to the title.
 */
export function SelectedMemberChips({
  members,
  onRemove,
  emptyLabel,
  title,
  summary,
  onRemovedLast,
}: {
  members: ChatContact[];
  onRemove: (userId: string) => void;
  emptyLabel?: string;
  title?: string;
  summary?: string;
  /** Focus goes here once no chip is left to take it (the search field). */
  onRemovedLast?: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  // After a removal, focus the chip that took the removed one's place (or
  // the one before it), so keyboard users do not fall back to the page.
  const refocusIndex = useRef<number | null>(null);
  useEffect(() => {
    const index = refocusIndex.current;
    if (index === null) return;
    refocusIndex.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-chip-remove]");
    if (buttons && buttons.length > 0) buttons[Math.min(index, buttons.length - 1)]?.focus();
    else onRemovedLast?.();
  }, [members, onRemovedLast]);

  const remove = (userId: string, index: number) => {
    if (members.length <= 1) {
      // The list (and maybe this whole block) unmounts with the last chip.
      onRemove(userId);
      onRemovedLast?.();
      return;
    }
    refocusIndex.current = index;
    onRemove(userId);
  };

  return (
    <div className="space-y-2">
      {title || summary ? (
        <div className="flex items-baseline justify-between gap-2">
          {title ? (
            <p id={titleId} className="text-label font-medium text-foreground">
              {title}
            </p>
          ) : (
            <span />
          )}
          {summary ? (
            <p className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
              {summary}
            </p>
          ) : null}
        </div>
      ) : null}

      {members.length === 0 ? (
        emptyLabel ? <p className="py-1 text-caption text-muted-foreground">{emptyLabel}</p> : null
      ) : (
        <ul ref={listRef} className="flex flex-wrap gap-2" aria-labelledby={title ? titleId : undefined}>
          {members.map((member, index) => {
            const label = displayLabelForChatContact(member);
            return (
              <li
                key={member.user_id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted py-0.5 pr-0.5 pl-1"
              >
                <ActorAvatar name={label} initials={initialOf(label)} size="md" />
                <span className="min-w-0 truncate text-label font-medium text-foreground">{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={t("chat.unselect_member", { name: label })}
                  data-chip-remove=""
                  onClick={() => remove(member.user_id, index)}
                >
                  <X aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
