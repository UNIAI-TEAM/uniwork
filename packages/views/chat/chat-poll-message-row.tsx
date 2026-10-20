"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChartColumn, Check, CircleCheck, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useVoteChatPollMessage } from "@uniwork/core/chat";
import { canViewPollVoters, groupPollVotersByOption, isPollExpired } from "@uniwork/core/chat/poll-utils";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatCard, ChatCardStatus } from "./chat-card";
import { CHAT_ON_BUBBLE_FILL, CHAT_ON_BUBBLE_HOVER, CHAT_ON_BUBBLE_LINE } from "./chat-message-row";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatPollVotersDialog } from "./chat-poll-voters-dialog";
import { resolveAvatarUrlFromNameContext } from "./chat-member-avatar";
import { chatPersonFaceClass } from "./chat-person-card";
import { initialsOf } from "./chat-initials";
import { pollOptionPercents } from "./chat-poll-percent";
import { toastChatError } from "./chat-error-message";

type PollPayload = NonNullable<ChatMessage["poll"]>;

/** "45%" at an option's end; min-width keeps the column straight across options. */
function PollOptionPercent({ percent, className }: { percent: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("min-w-8.5 text-right text-label font-semibold tabular-nums", className)}>
      {t("chat.poll_option_percent", { percent })}
    </span>
  );
}

/** Up to three faces of who picked an option, overlapping (canvas). */
function PollVoterFaces({ userIds, nameContext }: { userIds: string[]; nameContext: ChatNameContextEntry[] }) {
  if (userIds.length === 0) return null;
  return (
    <span aria-hidden className="flex -space-x-1.75">
      {userIds.slice(0, 3).map((userId) => {
        const name = nameContext.find((entry) => entry.user_id === userId)?.display_name?.trim() || userId;
        return (
          <ActorAvatar
            key={userId}
            name={name}
            initials={initialsOf(name)}
            avatarUrl={resolveAvatarUrlFromNameContext(nameContext, userId)}
            size="sm"
            className={cn("ring-2 ring-chat-bubble-other", chatPersonFaceClass(userId))}
          />
        );
      })}
    </span>
  );
}

function pollDeadlineLabel(deadlineAt: string, locale: string): string {
  const at = new Date(deadlineAt);
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const date = at.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${time}, ${date}`;
}

export function ChatPollMessageRow({
  messageId,
  workspaceId,
  roomId,
  poll,
  senderLabel,
  senderId,
  isOwn,
  ts,
  showSenderName,
  compactTop,
  avatar,
  nameContext,
  currentUserId,
  youLabel,
}: {
  messageId: string;
  workspaceId: string;
  roomId: string;
  poll: PollPayload;
  senderLabel: string;
  senderId?: string;
  isOwn?: boolean;
  ts?: number;
  showSenderName?: boolean;
  compactTop?: boolean;
  /** Theirs only: the sender's avatar at the card's foot, as a run's last bubble has. */
  avatar?: ReactNode;
  nameContext: ChatNameContextEntry[];
  currentUserId: string;
  youLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const votePoll = useVoteChatPollMessage(workspaceId);
  const deadlineAt = poll.settings.deadline_at ?? null;
  const [expired, setExpired] = useState(() => isPollExpired(deadlineAt));
  const [votersOpen, setVotersOpen] = useState(false);
  const [focusedOptionId, setFocusedOptionId] = useState<string | null>(null);

  useEffect(() => {
    setExpired(isPollExpired(deadlineAt));
  }, [deadlineAt]);

  useEffect(() => {
    if (!deadlineAt) return;
    const deadlineMs = Date.parse(deadlineAt);
    if (!Number.isFinite(deadlineMs)) return;
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) return;

    const timer = window.setTimeout(() => {
      setExpired(true);
      toast.info(t("chat.poll_closed_toast", { question: poll.question }));
    }, remainingMs);

    return () => window.clearTimeout(timer);
  }, [deadlineAt, poll.question, t]);

  const userVotes = poll.viewer_option_ids ?? [];
  const hasVoted = userVotes.length > 0;
  const totalVotes = poll.options.reduce((sum, option) => sum + option.votes, 0);
  const percents = pollOptionPercents(poll.options.map((option) => option.votes));
  const hideCounts = poll.settings.hide_results_until_vote && !hasVoted;
  const canViewVoters = useMemo(() => canViewPollVoters(poll), [poll]);
  const votersByOption = useMemo(
    () => groupPollVotersByOption(poll.votes_by_user, poll.options.map((option) => option.id)),
    [poll.options, poll.votes_by_user],
  );
  const topVotes = Math.max(0, ...poll.options.map((option) => option.votes));

  const handleVote = async (optionId: string) => {
    if (expired || votePoll.isPending) return;
    try {
      await votePoll.mutateAsync({ roomId, messageId, optionId });
    } catch (err) {
      toastChatError(err, t, t("chat.message_list.poll_vote_failed"));
    }
  };

  const multiple = poll.settings.allow_multiple;
  const questionId = useId();
  const hintId = useId();
  // Arrows move between options like any radio or checkbox group; Space or
  // Enter votes. Moving never votes on its own.
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-poll-option]"));
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    options[(index + step + options.length) % options.length]?.focus();
  };

  const openVoters = (optionId?: string) => {
    if (!canViewVoters || totalVotes === 0) return;
    setFocusedOptionId(optionId ?? null);
    setVotersOpen(true);
  };

  return (
    <>
      <ChatCard
        icon={ChartColumn}
        tone="blue"
        label={poll.settings.hide_voters ? t("chat.poll_anonymous_title") : t("chat.poll_message_badge")}
        senderLabel={senderLabel}
        senderId={senderId}
        isOwn={isOwn}
        ts={ts}
        showSenderName={showSenderName}
        compactTop={compactTop}
        avatar={avatar}
        status={expired ? <ChatCardStatus>{t("chat.poll_closed_status")}</ChatCardStatus> : null}
      >
        <p id={questionId} className="font-display text-body-lg font-bold text-balance text-foreground">
          {poll.question}
        </p>
        <p id={hintId} className="mt-px mb-2 flex items-center gap-1.25 text-caption text-muted-foreground">
          {poll.settings.hide_results_until_vote ? <EyeOff className="size-3.25 shrink-0" aria-hidden /> : null}
          {[
            multiple ? t("chat.message_list.poll_pick_many") : t("chat.message_list.poll_pick_one"),
            poll.settings.hide_results_until_vote ? t("chat.poll_setting_hide_results") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {/* Each option is a vote button, its share a bar under it and who
            picked it at its end. Hidden results draw plain choice boxes. A
            closed poll keeps full contrast (the result is the point now),
            marks the leader, and only stops taking votes. */}
        <div
          role={multiple ? "group" : "radiogroup"}
          aria-labelledby={questionId}
          aria-describedby={hintId}
          className="flex flex-col gap-1.5"
          onKeyDown={moveFocus}
        >
          {poll.options.map((option, index) => {
            const selected = userVotes.includes(option.id);
            const percent = percents[index] ?? 0;
            const showVoterCountButton = !hideCounts && canViewVoters && option.votes > 0;
            const locked = expired || votePoll.isPending;
            const leader = expired && !hideCounts && option.votes > 0 && option.votes === topVotes;
            const mark = leader ? (
              <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center border-2",
                  multiple ? "rounded-sm" : "rounded-full",
                  selected ? "border-brand bg-brand text-brand-foreground" : "border-faint-foreground",
                )}
              >
                {selected ? <Check className="size-3" strokeWidth={3.5} /> : null}
              </span>
            );
            const voteButton = (
              <button
                type="button"
                data-poll-option
                role={multiple ? "checkbox" : "radio"}
                aria-checked={selected}
                disabled={locked}
                aria-label={
                  hideCounts ? option.label : t("chat.poll_option_aria", { label: option.label, count: option.votes })
                }
                onClick={() => void handleVote(option.id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2.5 text-left text-body text-foreground",
                  hideCounts
                    ? cn("h-10 w-full rounded-xl border bg-chat-bubble-other px-3", CHAT_ON_BUBBLE_LINE, !locked && CHAT_ON_BUBBLE_HOVER)
                    : "h-8.5 rounded-md px-0.5",
                  locked && "cursor-default",
                )}
              >
                {mark}
                <span className={cn("min-w-0 flex-1", selected && "font-semibold", leader && "font-bold")}>
                  {option.label}
                </span>
              </button>
            );
            if (hideCounts) return <div key={option.id}>{voteButton}</div>;
            const percentClass = leader ? "font-bold text-success" : "text-chat-chip-foreground";
            return (
              <div key={option.id} className={cn(leader && "-mx-1.5 rounded-[10px] bg-success-soft px-1.5 pb-1.5")}>
                <div className="flex items-center gap-1.5">
                  {voteButton}
                  {showVoterCountButton ? (
                    <button
                      type="button"
                      aria-label={t("chat.message_list.poll_view_option_voters", {
                        count: option.votes,
                        label: option.label,
                      })}
                      onClick={() => openVoters(option.id)}
                      className={cn("flex h-8.5 shrink-0 items-center gap-2 rounded-[10px] pr-0.5 pl-1", CHAT_ON_BUBBLE_HOVER)}
                    >
                      <PollVoterFaces userIds={votersByOption[option.id] ?? []} nameContext={nameContext} />
                      <PollOptionPercent percent={percent} className={percentClass} />
                    </button>
                  ) : (
                    <PollOptionPercent
                      percent={percent}
                      className={cn("pr-0.5", option.votes > 0 ? percentClass : "text-muted-foreground")}
                    />
                  )}
                </div>
                <span aria-hidden className={cn("ml-8 block h-1.25 overflow-hidden rounded-full", leader ? "bg-success/15" : CHAT_ON_BUBBLE_FILL)}>
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-(--duration-standard) motion-reduce:transition-none",
                      leader ? "bg-success" : selected ? "bg-brand" : "bg-faint-foreground/70",
                    )}
                    // The share is data, not a style choice: the one inline value here.
                    style={{ width: `${percent}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>

        <div className={cn("mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2", CHAT_ON_BUBBLE_LINE)}>
          <p className="text-caption text-muted-foreground tabular-nums">
            {[
              expired ? t("chat.poll_closed") : null,
              hideCounts ? null : t("chat.poll_vote_hint", { count: totalVotes }),
              !expired && deadlineAt ? t("chat.poll_deadline_hint", { date: pollDeadlineLabel(deadlineAt, i18n.language) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {canViewVoters && totalVotes > 0 ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto px-0 text-label font-semibold text-brand"
              onClick={() => openVoters()}
            >
              {t("chat.poll_view_voters")}
            </Button>
          ) : null}
        </div>
        {poll.settings.hide_voters ? (
          <p className="mt-1 text-caption text-muted-foreground">{t("chat.poll_voters_hidden")}</p>
        ) : null}
      </ChatCard>

      {canViewVoters && poll.votes_by_user ? (
        <ChatPollVotersDialog
          open={votersOpen}
          onOpenChange={setVotersOpen}
          question={poll.question}
          options={poll.options}
          votesByUser={poll.votes_by_user}
          focusedOptionId={focusedOptionId}
          nameContext={nameContext}
          currentUserId={currentUserId}
          youLabel={youLabel}
        />
      ) : null}
    </>
  );
}
