"use client";

import { ListChecks, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";

type VoiceCallSummaryPayload = NonNullable<ChatMessage["voiceCallSummary"]>;
type ActionItem = VoiceCallSummaryPayload["action_items"][number];

export function VoiceCallSummaryRow({
  workspaceId,
  message,
  showSenderName,
  senderLabel,
  compactTop,
}: {
  workspaceId: string;
  message: ChatMessage;
  showSenderName?: boolean;
  senderLabel: string;
  compactTop?: boolean;
}) {
  const { t } = useTranslation();
  const summary = message.voiceCallSummary;
  const [createFor, setCreateFor] = useState<ActionItem | null>(null);

  if (!summary) return null;

  const summaryText = summary.summary.trim() || message.body.trim();

  return (
    <>
      <article
        className={cn(
          "flex w-full max-w-full justify-center",
          compactTop ? "mt-2.5" : "mt-4",
        )}
      >
        <div className="w-full max-w-lg rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm">
          {showSenderName ? (
            <p className="mb-2 text-caption font-medium text-brand">{senderLabel}</p>
          ) : null}

          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Sparkles className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {t("chat.voice_call_summary_badge")}
              </p>
              {summaryText ? (
                <p className="mt-1 whitespace-pre-wrap text-body leading-6 text-foreground">
                  {summaryText}
                </p>
              ) : null}

              {summary.highlights.length > 0 ? (
                <section className="mt-3 flex flex-col gap-1.5">
                  <p className="text-caption font-medium text-muted-foreground">
                    {t("chat.ai.highlights")}
                  </p>
                  <ul className="space-y-1.5">
                    {summary.highlights.map((highlight) => (
                      <li
                        key={highlight}
                        className="flex gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-body text-foreground"
                      >
                        <span
                          className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0">{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {summary.action_items.length > 0 ? (
                <section className="mt-3 flex flex-col gap-1.5">
                  <p className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
                    <ListChecks aria-hidden className="size-3.5" />
                    {t("chat.ai.action_items")}
                  </p>
                  <ul className="space-y-1.5">
                    {summary.action_items.map((item) => {
                      const canCreate = Boolean(item.source_message_id.trim());
                      return (
                        <li key={`${item.title}-${item.source_message_id}`}>
                          {canCreate ? (
                            <button
                              type="button"
                              className="w-full rounded-md border border-border bg-muted/40 px-2.5 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => setCreateFor(item)}
                            >
                              <p className="text-body font-medium text-foreground">{item.title}</p>
                              {item.owner || item.due ? (
                                <p className="mt-0.5 text-caption text-muted-foreground">
                                  {[item.owner, item.due].filter(Boolean).join(" · ")}
                                </p>
                              ) : null}
                              <p className="mt-1 text-caption text-brand">{t("chat.link.create_task")}</p>
                            </button>
                          ) : (
                            <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2">
                              <p className="text-body font-medium text-foreground">{item.title}</p>
                              {item.owner || item.due ? (
                                <p className="mt-0.5 text-caption text-muted-foreground">
                                  {[item.owner, item.due].filter(Boolean).join(" · ")}
                                </p>
                              ) : null}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-caption text-muted-foreground">{t("chat.ai.action_items_hint")}</p>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </article>

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
