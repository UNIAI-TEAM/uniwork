"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  groupPollVotersByOption,
  resolvePollVoterLabel,
  type PollVotesByUser,
} from "@uniwork/core/chat/poll-utils";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { ChatDialogBody, ChatDialogContent, ChatDialogHeader } from "./chat-dialog-layout";
import type { ChatNameContextEntry } from "./chat-page-utils";

type PollOption = { id: string; label: string; votes: number };

type VoterNames = {
  nameContext: ChatNameContextEntry[];
  currentUserId: string;
  youLabel: string;
};

function voterInitial(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || "?";
}

/** Who picked one option — the same list in the per-option and all-options views. */
function PollVoterList({ voterIds, names }: { voterIds: string[]; names: VoterNames }) {
  const { t } = useTranslation();
  if (voterIds.length === 0) {
    return <p className="text-caption text-muted-foreground">{t("chat.poll_voters_empty")}</p>;
  }
  return (
    <ul className="space-y-2">
      {voterIds.map((userId) => {
        const label = resolvePollVoterLabel(
          userId,
          names.nameContext,
          names.currentUserId,
          names.youLabel,
        );
        return (
          <li key={userId} className="flex min-w-0 items-center gap-2">
            <ActorAvatar name={label} initials={voterInitial(label)} size="sm" />
            <span className="truncate text-body text-foreground">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PollOptionVotersSection({
  option,
  voterIds,
  percent,
  names,
}: {
  option: PollOption;
  voterIds: string[];
  percent: number;
  names: VoterNames;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-body font-semibold text-foreground">{option.label}</p>
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {t("chat.poll_voters_option_count", { count: option.votes })}
          </span>
        </div>
        <Progress value={percent} aria-label={option.label} className="gap-0" />
      </div>
      <PollVoterList voterIds={voterIds} names={names} />
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
  const names: VoterNames = { nameContext, currentUserId, youLabel };

  const focusedOption = focusedOptionId
    ? options.find((option) => option.id === focusedOptionId)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChatDialogContent size="md">
        <ChatDialogHeader
          title={focusedOption ? focusedOption.label : t("chat.poll_voters_title")}
          description={question}
        />

        <ChatDialogBody className="space-y-3">
          <p className="text-overline uppercase text-muted-foreground">
            {focusedOption
              ? t("chat.poll_voters_option_count", { count: focusedOption.votes })
              : t("chat.poll_vote_hint", { count: totalVotes })}
          </p>
          {focusedOption ? (
            <PollVoterList voterIds={votersByOption[focusedOption.id] ?? []} names={names} />
          ) : (
            options.map((option) => (
              <PollOptionVotersSection
                key={option.id}
                option={option}
                voterIds={votersByOption[option.id] ?? []}
                percent={totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0}
                names={names}
              />
            ))
          )}
        </ChatDialogBody>
      </ChatDialogContent>
    </Dialog>
  );
}
