"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  groupPollVotersByOption,
  resolvePollVoterLabel,
  type PollVotesByUser,
} from "@uniwork/core/chat/poll-utils";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import type { ChatNameContextEntry } from "./chat-page-utils";

type PollOption = { id: string; label: string; votes: number };

function voterInitial(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || "?";
}

function PollOptionVotersSection({
  option,
  voterIds,
  ratio,
  nameContext,
  currentUserId,
  youLabel,
}: {
  option: PollOption;
  voterIds: string[];
  ratio: number;
  nameContext: ChatNameContextEntry[];
  currentUserId: string;
  youLabel: string;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-body font-semibold text-foreground">{option.label}</p>
        <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
          {t("chat.poll_voters_option_count", { count: option.votes })}
        </span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-brand/60 transition-all"
          style={{ width: `${Math.round(ratio * 100)}%` }}
          aria-hidden
        />
      </div>
      {voterIds.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("chat.poll_voters_empty")}</p>
      ) : (
        <ul className="space-y-2">
          {voterIds.map((userId) => {
            const label = resolvePollVoterLabel(userId, nameContext, currentUserId, youLabel);
            return (
              <li key={`${option.id}-${userId}`} className="flex items-center gap-2">
                <ActorAvatar name={label} initials={voterInitial(label)} size="sm" />
                <span className="text-body text-foreground">{label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ChatPollVotersDialog({
  open,
  onOpenChange,
  question,
  options,
  votesByUser,
  focusedOptionId,
  nameContext,
  currentUserId,
  youLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: string;
  options: PollOption[];
  votesByUser: PollVotesByUser;
  focusedOptionId?: string | null;
  nameContext: ChatNameContextEntry[];
  currentUserId: string;
  youLabel: string;
}) {
  const { t } = useTranslation();
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  const votersByOption = useMemo(
    () => groupPollVotersByOption(votesByUser, options.map((option) => option.id)),
    [options, votesByUser],
  );

  const focusedOption = focusedOptionId
    ? options.find((option) => option.id === focusedOptionId)
    : undefined;
  const singleOptionMode = focusedOption != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(80vh,520px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-sm">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle>{singleOptionMode ? focusedOption.label : t("chat.poll_voters_title")}</DialogTitle>
          <DialogDescription className="line-clamp-2 text-caption text-muted-foreground">
            {question}
          </DialogDescription>
          {singleOptionMode ? (
            <p className="text-caption text-muted-foreground">
              {t("chat.poll_voters_option_count", { count: focusedOption.votes })}
            </p>
          ) : (
            <p className="text-caption text-muted-foreground">
              {t("chat.poll_vote_hint", { count: totalVotes })}
            </p>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {singleOptionMode ? (
            (() => {
              const voterIds = votersByOption[focusedOption.id] ?? [];
              if (voterIds.length === 0) {
                return <p className="text-caption text-muted-foreground">{t("chat.poll_voters_empty")}</p>;
              }
              return (
                <ul className="space-y-2">
                  {voterIds.map((userId) => {
                    const label = resolvePollVoterLabel(userId, nameContext, currentUserId, youLabel);
                    return (
                      <li key={userId} className="flex items-center gap-2 rounded-lg px-1 py-1">
                        <ActorAvatar name={label} initials={voterInitial(label)} size="sm" />
                        <span className="text-body text-foreground">{label}</span>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          ) : (
            options.map((option) => {
              const voterIds = votersByOption[option.id] ?? [];
              const ratio = totalVotes > 0 ? option.votes / totalVotes : 0;
              return (
                <PollOptionVotersSection
                  key={option.id}
                  option={option}
                  voterIds={voterIds}
                  ratio={ratio}
                  nameContext={nameContext}
                  currentUserId={currentUserId}
                  youLabel={youLabel}
                />
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
