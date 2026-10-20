"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  groupPollVotersByOption,
  resolvePollVoterLabel,
  type PollVotesByUser,
} from "@uniwork/core/chat/poll-utils";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import { FormDialogBody, FormDialogContent, FormDialogHeader } from "../common/form-dialog";
import { CHAT_DIALOG_BODY_CLASS, CHAT_DIALOG_CLASS, CHAT_DIALOG_WIDTH } from "./chat-dialog-look";
import { resolveAvatarUrlFromNameContext } from "./chat-member-avatar";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { chatPersonFaceClass } from "./chat-person-card";
import { initialsOf } from "./chat-initials";
import { pollOptionPercents } from "./chat-poll-percent";

type PollOption = { id: string; label: string; votes: number };

type VoterNames = {
  nameContext: ChatNameContextEntry[];
  currentUserId: string;
  youLabel: string;
};

/** Who picked one option — the same list in the per-option and all-options views. */
function PollVoterList({ voterIds, names }: { voterIds: string[]; names: VoterNames }) {
  const { t } = useTranslation();
  if (voterIds.length === 0) {
    return <p className="text-caption text-muted-foreground">{t("chat.poll_voters_empty")}</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
      {voterIds.map((userId) => {
        const label = resolvePollVoterLabel(
          userId,
          names.nameContext,
          names.currentUserId,
          names.youLabel,
        );
        const isYou = label === names.youLabel;
        // "Bạn" in words, but the face keeps the viewer's own initials (canvas).
        const faceName = isYou ? resolvePollVoterLabel(userId, names.nameContext, "", names.youLabel) : label;
        return (
          <li key={userId} className="flex min-w-0 items-center gap-2.5">
            <ActorAvatar
              name={faceName}
              initials={initialsOf(faceName)}
              avatarUrl={resolveAvatarUrlFromNameContext(names.nameContext, userId)}
              size="fluid"
              className={cn("size-7 text-micro", chatPersonFaceClass(userId))}
            />
            <span className={cn("truncate text-body text-foreground", isYou && "font-semibold")}>{label}</span>
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
  mine,
  names,
}: {
  option: PollOption;
  voterIds: string[];
  percent: number;
  /** The viewer picked this option: the brand wash and a "Bạn đã chọn" chip (canvas). */
  mine: boolean;
  names: VoterNames;
}) {
  const { t } = useTranslation();
  return (
    <section
      className={cn(
        "space-y-3 rounded-xl border px-3.5 pt-3 pb-3.5",
        mine ? "border-brand/25 bg-brand-subtle/40" : "border-border",
      )}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="min-w-0 truncate text-body-lg font-semibold text-foreground">{option.label}</p>
          {mine ? (
            <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-brand-subtle px-2 text-micro font-semibold text-brand">
              <Check className="size-3" strokeWidth={3} aria-hidden />
              {t("chat.poll_voters_your_pick")}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-caption tabular-nums text-muted-foreground">
            {t("chat.poll_voters_option_share", { count: option.votes, percent })}
          </span>
        </div>
        <span
          role="progressbar"
          aria-label={option.label}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className={cn("block h-1.5 overflow-hidden rounded-full", mine ? "bg-brand-subtle" : "bg-muted")}
        >
          <span
            className={cn("block h-full rounded-full", mine ? "bg-brand" : "bg-faint-foreground/70")}
            // The share is data, not a style choice.
            style={{ width: `${percent}%` }}
          />
        </span>
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
  // The same shares the card shows: whole percents that add up to 100.
  const percents = pollOptionPercents(options.map((option) => option.votes));
  const myPicks = votesByUser[currentUserId] ?? [];

  const focusedOption = focusedOptionId
    ? options.find((option) => option.id === focusedOptionId)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="md" className={`${CHAT_DIALOG_CLASS} ${CHAT_DIALOG_WIDTH.narrow}`}>
        <FormDialogHeader
          title={focusedOption ? focusedOption.label : t("chat.poll_voters_title")}
          description={question}
        />

        <FormDialogBody className={`${CHAT_DIALOG_BODY_CLASS} space-y-2.5 pt-4.5 pb-6`}>
          <p className="text-micro font-semibold tracking-wider text-muted-foreground uppercase tabular-nums">
            {focusedOption
              ? t("chat.poll_voters_option_count", { count: focusedOption.votes })
              : t("chat.poll_vote_hint", { count: totalVotes })}
          </p>
          {focusedOption ? (
            <PollVoterList voterIds={votersByOption[focusedOption.id] ?? []} names={names} />
          ) : (
            options.map((option, index) => (
              <PollOptionVotersSection
                key={option.id}
                option={option}
                voterIds={votersByOption[option.id] ?? []}
                percent={percents[index] ?? 0}
                mine={myPicks.includes(option.id)}
                names={names}
              />
            ))
          )}
        </FormDialogBody>
      </FormDialogContent>
    </Dialog>
  );
}
