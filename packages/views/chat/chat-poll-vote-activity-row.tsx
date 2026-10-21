"use client";

import { ChartColumn } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

/** Zalo-style centred notice when someone votes in a poll. */
export function ChatPollVoteActivityRow({
  senderLabel,
  question,
  onViewPoll,
  className,
}: {
  senderLabel: string;
  question: string;
  onViewPoll?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex justify-center px-3 py-1.5", className)}>
      <div className="flex max-w-[min(100%,36rem)] items-center gap-2 rounded-full bg-surface-raised px-3 py-2 shadow-menu ring-1 ring-surface-border/70 supports-backdrop-filter:backdrop-blur-md">
        <ChartColumn className="size-4 shrink-0 text-tint-green-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-caption leading-snug text-foreground">
          <Trans
            i18nKey="chat.poll_vote_activity_line"
            values={{ name: senderLabel, question }}
            components={{ b: <span className="font-semibold" /> }}
          />
        </p>
        {onViewPoll ? (
          <Button type="button" variant="link" size="sm" className="h-auto shrink-0 px-1 py-0 text-caption" onClick={onViewPoll}>
            {t("chat.poll_vote_activity_view")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
