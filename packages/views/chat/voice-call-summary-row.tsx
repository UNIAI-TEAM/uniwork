"use client";

import { ListChecks, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./chat-messages";
import { ChatCard } from "./chat-card";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";

type VoiceCallSummaryPayload = NonNullable<ChatMessage["voiceCallSummary"]>;
type ActionItem = VoiceCallSummaryPayload["action_items"][number];

export function VoiceCallSummaryRow({
  workspaceId,
  message,
  showSenderName,
  senderLabel,
  compactTop,
  isOwn,
}: {
  workspaceId: string;
  message: ChatMessage;
  showSenderName?: boolean;
  senderLabel: string;
  compactTop?: boolean;
  isOwn?: boolean;
}) {
  const { t } = useTranslation();
  const summary = message.voiceCallSummary;
  const [createFor, setCreateFor] = useState<ActionItem | null>(null);

  if (!summary) return null;

  const summaryText = summary.summary.trim() || message.body.trim();

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
        {summaryText ? (
          <p className="whitespace-pre-wrap text-body leading-relaxed text-foreground text-pretty">{summaryText}</p>
        ) : null}

        {summary.highlights.length > 0 ? (
          <section className="mt-3 flex flex-col gap-1.5">
            <h4 className="text-overline text-muted-foreground uppercase">{t("chat.ai.highlights")}</h4>
            <ul className="space-y-1">
              {summary.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2 text-body text-foreground">
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
              {summary.action_items.map((item) => {
                const canCreate = Boolean(item.source_message_id.trim());
                const detail =
                  item.owner || item.due ? (
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {[item.owner, item.due].filter(Boolean).join(" · ")}
                    </p>
                  ) : null;
                return (
                  <li key={`${item.title}-${item.source_message_id}`}>
                    {canCreate ? (
                      <button
                        type="button"
                        className="w-full rounded-lg bg-muted px-3 py-2 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                        onClick={() => setCreateFor(item)}
                      >
                        <p className="text-body font-medium text-foreground">{item.title}</p>
                        {detail}
                        <p className="mt-1 text-caption font-medium text-brand-subtle-foreground">
                          {t("chat.link.create_task")}
                        </p>
                      </button>
                    ) : (
                      <div className="rounded-lg bg-muted px-3 py-2">
                        <p className="text-body font-medium text-foreground">{item.title}</p>
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
