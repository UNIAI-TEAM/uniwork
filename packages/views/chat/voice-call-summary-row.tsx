"use client";

import { ListChecks, PhoneCall, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./chat-messages";
import { ChatCard } from "./chat-card";
import { formatMessageTime } from "./chat-message-time";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";
import { formatVoiceCallDuration } from "./voice-call-duration";

type VoiceCallSummaryPayload = NonNullable<ChatMessage["voiceCallSummary"]>;
type ActionItem = VoiceCallSummaryPayload["action_items"][number];

export function VoiceCallSummaryRow({
  workspaceId,
  message,
  showSenderName,
  senderLabel,
  compactTop,
  isOwn,
  callLog,
  onJumpToMessage,
}: {
  workspaceId: string;
  message: ChatMessage;
  showSenderName?: boolean;
  senderLabel: string;
  compactTop?: boolean;
  isOwn?: boolean;
  /** The call's log message, when it is loaded, for the "from the call at …" line. */
  callLog?: ChatMessage;
  /** The page's jump-to-message, so the summary points back at its call. */
  onJumpToMessage?: (messageId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const summary = message.voiceCallSummary;
  const [createFor, setCreateFor] = useState<ActionItem | null>(null);

  if (!summary) return null;

  const summaryText = summary.summary.trim() || message.body.trim();
  const empty = !summaryText && summary.highlights.length === 0 && summary.action_items.length === 0;
  const callLogId = summary.call_log_message_id.trim();
  const callDuration = callLog?.voiceCall?.duration_seconds;
  const sourceLabel = callLog
    ? callDuration
      ? t("chat.voice_call_summary_source_duration", {
          time: formatMessageTime(callLog.ts, i18n.language),
          duration: formatVoiceCallDuration(callDuration),
        })
      : t("chat.voice_call_summary_source", { time: formatMessageTime(callLog.ts, i18n.language) })
    : t("chat.voice_call_summary_source_link");

  return (
    <>
      {/* AI output: the overline says it was generated, the header carries
          when, and every action item points back to the message it came from
          (Agent Principles — attributed, timestamped, sourced). */}
      <ChatCard
        icon={Sparkles}
        tone="brand"
        label={t("chat.voice_call_summary_badge")}
        senderLabel={senderLabel}
        senderId={message.sender}
        isOwn={isOwn}
        ts={message.ts}
        showSenderName={showSenderName}
        compactTop={compactTop}
        wide
      >
        {/* Sourced: the summary says which call it came from and links back to it. */}
        {callLogId && (callLog || onJumpToMessage) ? (
          onJumpToMessage ? (
            <button
              type="button"
              className="mb-2 inline-flex items-center gap-1.5 rounded-md text-caption font-medium text-brand-subtle-foreground hover:underline"
              onClick={() => onJumpToMessage(callLogId)}
            >
              <PhoneCall aria-hidden className="size-3.5" />
              {sourceLabel}
            </button>
          ) : (
            <p className="mb-2 inline-flex items-center gap-1.5 text-caption text-muted-foreground">
              <PhoneCall aria-hidden className="size-3.5" />
              {sourceLabel}
            </p>
          )
        ) : null}

        {summaryText ? (
          <p className="whitespace-pre-wrap text-body leading-relaxed text-foreground text-pretty">{summaryText}</p>
        ) : null}

        {empty ? <p className="text-body text-muted-foreground">{t("chat.voice_call_summary_empty")}</p> : null}

        {summary.highlights.length > 0 ? (
          <section className="mt-3 flex flex-col gap-1.5">
            <h4 className="text-overline text-muted-foreground uppercase">{t("chat.ai.highlights")}</h4>
            <ul className="space-y-1">
              {summary.highlights.map((highlight, index) => (
                <li key={`${index}-${highlight}`} className="flex gap-2 text-body text-foreground">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                  <span className="min-w-0 text-pretty">{highlight}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {summary.action_items.length > 0 ? (
          <section className="mt-3 flex flex-col gap-1.5">
            <h4 className="flex items-center gap-1.5 text-overline text-muted-foreground uppercase">
              <ListChecks aria-hidden className="size-3.5" />
              {t("chat.ai.action_items")}
            </h4>
            <ul className="space-y-1.5">
              {summary.action_items.map((item, index) => {
                const canCreate = Boolean(item.source_message_id.trim());
                const detail =
                  item.owner || item.due ? (
                    <span className="mt-0.5 block text-caption text-muted-foreground">
                      {[item.owner, item.due].filter(Boolean).join(" · ")}
                    </span>
                  ) : null;
                return (
                  <li key={`${index}-${item.source_message_id}-${item.title}`}>
                    {canCreate ? (
                      <button
                        type="button"
                        className="w-full rounded-lg bg-muted px-3 py-2 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                        onClick={() => setCreateFor(item)}
                      >
                        <span className="block text-body font-medium text-foreground">{item.title}</span>
                        {detail}
                        <span className="mt-1 block text-caption font-medium text-brand-subtle-foreground">
                          {t("chat.link.create_task")}
                        </span>
                      </button>
                    ) : (
                      <div className="rounded-lg bg-muted px-3 py-2">
                        <span className="block text-body font-medium text-foreground">{item.title}</span>
                        {detail}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-caption text-muted-foreground">{t("chat.ai.action_items_hint")}</p>
          </section>
        ) : null}
      </ChatCard>

      <CreateTaskFromMessageDialog
        open={createFor != null}
        onOpenChange={(next) => {
          if (!next) setCreateFor(null);
        }}
        workspaceId={workspaceId}
        messageId={createFor?.source_message_id ?? ""}
        messageBody={createFor?.title ?? ""}
      />
    </>
  );
}
