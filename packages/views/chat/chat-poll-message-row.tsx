"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useVoteChatPollMessage } from "@uniwork/core/chat";
import { canViewPollVoters, isPollExpired } from "@uniwork/core/chat/poll-utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatCard, ChatCardStatus } from "./chat-card";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatPollVotersDialog } from "./chat-poll-voters-dialog";
import { toastChatError } from "./chat-error-message";

type PollPayload = NonNullable<ChatMessage["poll"]>;

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
  const hideCounts = poll.settings.hide_results_until_vote && !hasVoted;
  const canViewVoters = useMemo(() => canViewPollVoters(poll), [poll]);

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
        icon={BarChart3}
        tone="blue"
        label={t("chat.poll_message_badge")}
        senderLabel={senderLabel}
        senderId={senderId}
        isOwn={isOwn}
        ts={ts}
        showSenderName={showSenderName}
        compactTop={compactTop}
        status={expired ? <ChatCardStatus>{t("chat.poll_closed_status")}</ChatCardStatus> : null}
      >
        <p id={questionId} className="text-body font-semibold text-balance text-foreground">
          {poll.question}
        </p>
        <p id={hintId} className="mt-0.5 mb-3 text-caption text-muted-foreground">
          {multiple ? t("chat.message_list.poll_pick_many") : t("chat.message_list.poll_pick_one")}
        </p>

        {/* Each option is a vote button with its share drawn behind it. A
            closed poll keeps full contrast (the result is the point now) and
            only stops taking votes. */}
        <div
          role={multiple ? "group" : "radiogroup"}
          aria-labelledby={questionId}
          aria-describedby={hintId}
          className="space-y-1.5"
          onKeyDown={moveFocus}
        >
          {poll.options.map((option) => {
            const selected = userVotes.includes(option.id);
            const ratio = totalVotes > 0 ? option.votes / totalVotes : 0;
            const showVoterCountButton = !hideCounts && canViewVoters && option.votes > 0;
            const locked = expired || votePoll.isPending;
            return (
              <div key={option.id}>
                <div
                  className={cn(
                    "relative flex overflow-hidden rounded-lg border transition-colors duration-(--duration-fast)",
                    selected ? "border-brand" : "border-border",
                  )}
                >
                  <button
                    type="button"
                    data-poll-option
                    role={multiple ? "checkbox" : "radio"}
                    aria-checked={selected}
                    disabled={locked}
                    aria-label={
                      hideCounts
                        ? option.label
                        : t("chat.poll_option_aria", { label: option.label, count: option.votes })
                    }
                    onClick={() => void handleVote(option.id)}
                    className={cn(
                      "relative min-h-9 min-w-0 flex-1 px-3 py-2 text-left pointer-coarse:min-h-11",
                      !locked && "hover:bg-surface-hover",
                      locked && "cursor-default",
                    )}
                  >
                    {!hideCounts ? (
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 transition-[width] duration-(--duration-standard) motion-reduce:transition-none",
                          selected ? "bg-brand-subtle" : "bg-muted",
                        )}
                        // The share is data, not a style choice: the one inline value here.
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                        aria-hidden
                      />
                    ) : null}
                    <span className={cn("relative text-body text-foreground", selected && "font-semibold")}>
                      {option.label}
                    </span>
                  </button>
                  {!hideCounts ? (
                    showVoterCountButton ? (
                      <button
                        type="button"
                        aria-label={t("chat.message_list.poll_view_option_voters", {
                          count: option.votes,
                          label: option.label,
                        })}
                        onClick={() => openVoters(option.id)}
                        className="relative shrink-0 border-l border-border px-3 py-2 text-caption font-semibold text-brand-subtle-foreground tabular-nums hover:bg-surface-hover"
                      >
                        {option.votes}
                      </button>
                    ) : (
                      <span className="relative shrink-0 border-l border-border px-3 py-2 text-caption text-muted-foreground tabular-nums">
                        {option.votes}
                      </span>
                    )
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-caption text-muted-foreground tabular-nums">
            {expired
              ? t("chat.poll_closed")
              : deadlineAt
                ? t("chat.poll_deadline_hint", {
                    date: new Date(deadlineAt).toLocaleString(i18n.language, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })
                : t("chat.poll_vote_hint", { count: totalVotes })}
          </p>
          {canViewVoters && totalVotes > 0 ? (
            <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => openVoters()}>
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
