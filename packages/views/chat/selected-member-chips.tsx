"use client";

import { X } from "lucide-react";
import { useId } from "react";
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
}: {
  members: ChatContact[];
  onRemove: (userId: string) => void;
  emptyLabel?: string;
  title?: string;
  summary?: string;
}) {
  const { t } = useTranslation();
  const titleId = useId();

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
        <ul className="flex flex-wrap gap-2" aria-labelledby={title ? titleId : undefined}>
          {members.map((member) => {
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
                  onClick={() => onRemove(member.user_id)}
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
