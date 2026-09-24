"use client";

import { Mail, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Person } from "@uniwork/core/types/people";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The two ways to reach someone straight from their card or row: open a chat,
 * or write an email. They sit above the card's stretched link (`relative
 * z-10`), so pressing one never also opens the profile. Chat is offered only
 * to a live colleague who is not the reader.
 */
export function PersonQuickActions({
  person,
  onChat,
  className,
}: {
  person: Person;
  onChat: (userId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const canChat = !person.is_self && person.status !== "deactivated";
  return (
    <span className={cn("relative z-10 flex shrink-0 items-center gap-0.5", className)}>
      {canChat ? (
        <ActionTooltip label={t("people.chat")}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("people.chat_person", { name: person.display_name })}
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onChat(person.user_id);
            }}
          >
            <MessageSquare aria-hidden="true" />
          </Button>
        </ActionTooltip>
      ) : null}
      {/* A native title rather than the tooltip primitive: its trigger is a
          button, and this has to stay an anchor for mailto to work. */}
      <ButtonLink
        variant="ghost"
        size="icon-sm"
        href={`mailto:${person.email}`}
        title={person.email}
        aria-label={t("people.email_person", { name: person.display_name })}
        className="text-muted-foreground hover:text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <Mail aria-hidden="true" />
      </ButtonLink>
    </span>
  );
}

function ActionTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
