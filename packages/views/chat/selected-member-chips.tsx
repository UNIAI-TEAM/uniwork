"use client";

import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function SelectedMemberChips({
  members,
  onRemove,
  emptyLabel,
  title,
  countBadge,
}: {
  members: ChatContact[];
  onRemove: (userId: string) => void;
  emptyLabel?: string;
  title?: string;
  countBadge?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      {title || countBadge ? (
        <div className="flex items-center justify-between gap-2">
          {title ? (
            <p className="text-label font-medium text-foreground">{title}</p>
          ) : (
            <span />
          )}
          {countBadge ? (
            <Badge variant="secondary" className="tabular-nums">
              {countBadge}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {members.length === 0 ? (
        emptyLabel ? (
          <p className="px-0.5 py-1 text-caption text-muted-foreground">{emptyLabel}</p>
        ) : null
      ) : (
        <ul className="flex flex-wrap gap-2">
          {members.map((member) => {
            const label = displayLabelForChatContact(member);
            return (
              <li key={member.user_id}>
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/60 py-1 pl-1 pr-1.5">
                  <ActorAvatar
                    name={member.display_name}
                    initials={initialOf(member.display_name)}
                    size="sm"
                  />
                  <span className="min-w-0 truncate text-caption font-medium text-foreground">
                    {label}
                  </span>
                  <button
                    type="button"
                    className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                    aria-label={t("chat.remove_member", { name: label })}
                    onClick={() => onRemove(member.user_id)}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
