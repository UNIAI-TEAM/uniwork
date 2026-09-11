"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useVoteChatPollMessage } from "@uniwork/core/chat";
import { canViewPollVoters, isPollExpired } from "@uniwork/core/chat/poll-utils";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatPollVotersDialog } from "./chat-poll-voters-dialog";

type PollPayload = NonNullable<ChatMessage["poll"]>;

export function ChatPollMessageRow({
  messageId,
  workspaceId,
  roomId,
  poll,
  senderLabel,
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
  showSenderName?: boolean;
  compactTop?: boolean;
  nameContext: ChatNameContextEntry[];
  currentUserId: string;
  youLabel: string;
}) {
  const { t } = useTranslation();
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

  const handleVote = (optionId: string) => {
    if (expired || votePoll.isPending) return;
    void votePoll.mutateAsync({ roomId, messageId, optionId });
  };

  const openVoters = (optionId?: string) => {
    if (!canViewVoters || totalVotes === 0) return;
    setFocusedOptionId(optionId ?? null);
    setVotersOpen(true);
  };

  return (
    <>
      <article className={cn("flex w-full max-w-full justify-center py-1", compactTop ? "pt-0.5" : "pt-3")}>
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
          {showSenderName ? (
            <p className="mb-1 text-caption font-medium text-brand">{senderLabel}</p>
          ) : null}

          <div className="mb-3 flex items-start gap-2">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <BarChart3 className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {t("chat.poll_message_badge")}
              </p>
              <p className="mt-1 text-body font-semibold text-foreground">{poll.question}</p>
            </div>
          </div>

          <ul className="space-y-2">
            {poll.options.map((option) => {
              const selected = userVotes.includes(option.id);
              const ratio = totalVotes > 0 ? option.votes / totalVotes : 0;
              const showVoterCountButton = !hideCounts && canViewVoters && option.votes > 0;
              return (
                <li key={option.id}>
                  <div
                    className={cn(
                      "relative flex overflow-hidden rounded-lg border transition-colors",
                      selected ? "border-brand bg-brand/5" : "border-border",
                      (expired || votePoll.isPending) && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      disabled={expired || votePoll.isPending}
                      aria-pressed={selected}
                      onClick={() => handleVote(option.id)}
                      className={cn(
                        "relative min-w-0 flex-1 px-3 py-2 text-left transition-colors",
                        !selected && !expired && "hover:bg-muted/40",
                        (expired || votePoll.isPending) && "cursor-not-allowed",
                      )}
                    >
                      {!hideCounts ? (
                        <span
                          className="absolute inset-y-0 left-0 bg-brand/10 transition-all"
                          style={{ width: `${Math.round(ratio * 100)}%` }}
                          aria-hidden
                        />
                      ) : null}
                      <span className="relative text-body text-foreground">{option.label}</span>
                    </button>
                    {!hideCounts ? (
                      showVoterCountButton ? (
                        <button
                          type="button"
                          aria-label={t("chat.poll_view_voters")}
                          onClick={() => openVoters(option.id)}
                          className="relative shrink-0 border-l border-border px-3 py-2 text-caption tabular-nums text-brand hover:bg-brand/5"
                        >
                          {option.votes}
                        </button>
                      ) : (
                        <span className="relative shrink-0 border-l border-border px-3 py-2 text-caption tabular-nums text-muted-foreground">
                          {option.votes}
                        </span>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 space-y-1">
            <p className="text-caption text-muted-foreground">
              {expired
                ? t("chat.poll_closed")
                : deadlineAt
                  ? t("chat.poll_deadline_hint", {
                      date: new Date(deadlineAt).toLocaleString(),
                    })
                  : t("chat.poll_vote_hint", { count: totalVotes })}
            </p>
            {canViewVoters && totalVotes > 0 ? (
              <button
                type="button"
                onClick={() => openVoters()}
                className="text-caption text-brand hover:underline"
              >
                {t("chat.poll_view_voters")}
              </button>
            ) : null}
            {poll.settings.hide_voters ? (
              <p className="text-caption text-muted-foreground">{t("chat.poll_voters_hidden")}</p>
            ) : null}
          </div>
        </div>
      </article>

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
