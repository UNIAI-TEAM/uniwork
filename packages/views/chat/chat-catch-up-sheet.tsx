"use client";

import { useId, useState } from "react";
import { AlertCircle, CheckCircle2, History, ListChecks, MessageSquareText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatCatchUpActionItem, ChatCatchUpResponse } from "@uniwork/core/types";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Notice } from "../common/notice";
import { formatMessageDateTime, formatMessageTime } from "./chat-message-time";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";
import { catchUpGeneratedAt } from "./use-chat-catch-up-ui";

function isEmptyBrief(result: ChatCatchUpResponse): boolean {
  return (
    result.message_count === 0 &&
    result.highlights.length === 0 &&
    result.action_items.length === 0
  );
}

/** "14:05" today, "12 thg 9, 14:05" on another day — always in the app locale. */
function formatBriefTime(ts: number, locale: string): string {
  const date = new Date(ts);
  if (date.toDateString() === new Date().toDateString()) return formatMessageTime(ts, locale);
  return date.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function parseTs(value: string): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function SectionLabel({ icon: Icon, children }: { icon?: typeof ListChecks; children: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-overline text-muted-foreground uppercase">
      {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
      {children}
    </h3>
  );
}

/** Placeholder in the brief's shape: attribution, summary lines, list rows. */
function CatchUpSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex flex-col gap-5">
        <Skeleton className="h-4 w-44" />
        <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatCatchUpSheet({
  open,
  onOpenChange,
  loading,
  error,
  result,
  onRetry,
  workspaceId,
  generatedAt,
  onJumpToMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  /** Already-translated reason from useChatCatchUpUi (never a raw backend string). */
  error: string | null;
  result: ChatCatchUpResponse | null;
  onRetry?: () => void;
  workspaceId: string;
  /** Generation time; defaults to when useChatCatchUpUi received the result. */
  generatedAt?: number | null;
  /** Scroll the timeline to a suggested action's source message. */
  onJumpToMessage?: (messageId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const empty = Boolean(result && !error && !loading && isEmptyBrief(result));
  const [createFor, setCreateFor] = useState<ChatCatchUpActionItem | null>(null);
  const idBase = useId();

  const failedTitle = t("chat.ai.catch_up_failed");
  const errorDetail = error && error !== failedTitle ? error : null;
  const stamp = generatedAt ?? catchUpGeneratedAt(result);
  const since = result ? parseTs(result.since) : null;

  const jumpTo = (messageId: string) => {
    onOpenChange(false);
    onJumpToMessage?.(messageId);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-title">
              <History aria-hidden className="size-4 text-muted-foreground" />
              {t("chat.ai.catch_up_title")}
            </SheetTitle>
            <SheetDescription>
              {result?.mode === "recent"
                ? t("chat.ai.catch_up_description_recent")
                : t("chat.ai.catch_up_description")}
            </SheetDescription>
          </SheetHeader>

          {!loading && error ? (
            <Notice
              tone="destructive"
              icon={AlertCircle}
              live="assertive"
              action={
                onRetry ? (
                  <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                    {t("common.retry")}
                  </Button>
                ) : undefined
              }
            >
              <p>{failedTitle}</p>
              {errorDetail ? <p className="font-normal">{errorDetail}</p> : null}
            </Notice>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            {loading ? <CatchUpSkeleton label={t("chat.ai.catch_up_loading")} /> : null}

            {!loading && !error && empty ? (
              <div
                className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
                role="status"
              >
                <IconTile icon={CheckCircle2} size="lg" tone="success" />
                <div className="flex max-w-[36ch] flex-col gap-1">
                  <p className="text-body font-medium text-foreground">{t("chat.ai.catch_up_empty_title")}</p>
                  <p className="text-caption text-muted-foreground">{t("chat.ai.catch_up_empty")}</p>
                </div>
              </div>
            ) : null}

            {!loading && !error && result && !empty ? (
              <div className="flex flex-col gap-5">
                <section className="flex flex-col gap-2" aria-labelledby={`${idBase}-attribution`}>
                  <p
                    id={`${idBase}-attribution`}
                    className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted-foreground"
                  >
                    <IconTile icon={Sparkles} size="xs" tone="brand" />
                    <span className="font-medium text-foreground">{t("chat.ai.catch_up_attribution")}</span>
                    {stamp ? (
                      <time dateTime={new Date(stamp).toISOString()} title={formatMessageDateTime(stamp, locale)}>
                        {t("chat.ai.catch_up_generated_at", { time: formatBriefTime(stamp, locale) })}
                      </time>
                    ) : null}
                  </p>
                  <div className="rounded-lg border border-border bg-surface px-3 py-3">
                    <p className="whitespace-pre-wrap text-body leading-6 text-foreground">{result.summary}</p>
                    {result.message_count > 0 || since ? (
                      <p className="mt-2 flex flex-wrap gap-x-1.5 text-caption text-muted-foreground">
                        {result.message_count > 0 ? (
                          <span>{t("chat.ai.message_count", { count: result.message_count })}</span>
                        ) : null}
                        {result.message_count > 0 && since ? <span aria-hidden>·</span> : null}
                        {since ? (
                          <time dateTime={new Date(since).toISOString()} title={formatMessageDateTime(since, locale)}>
                            {t("chat.ai.catch_up_since", { time: formatBriefTime(since, locale) })}
                          </time>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </section>

                {result.highlights.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <SectionLabel>{t("chat.ai.highlights")}</SectionLabel>
                    <ul className="space-y-2">
                      {result.highlights.map((h) => (
                        <li
                          key={h}
                          className="flex gap-2 rounded-md border border-border bg-surface px-3 py-2 text-body text-foreground"
                        >
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                          <span className="min-w-0">{h}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {result.action_items.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <SectionLabel icon={ListChecks}>{t("chat.ai.action_items")}</SectionLabel>
                    <ul className="space-y-2">
                      {result.action_items.map((item, index) => {
                        const sourceId = item.source_message_id;
                        const titleId = `${idBase}-item-${index}`;
                        return (
                          <li
                            key={`${item.title}-${sourceId}-${index}`}
                            className="rounded-md border border-border bg-surface px-3 py-2.5"
                          >
                            <p id={titleId} className="text-body font-medium text-foreground">
                              {item.title}
                            </p>
                            {item.owner || item.due ? (
                              <p className="mt-0.5 text-caption text-muted-foreground">
                                {[item.owner, item.due].filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                            {sourceId ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  aria-describedby={titleId}
                                  onClick={() => setCreateFor(item)}
                                >
                                  <ListChecks aria-hidden />
                                  {t("chat.link.create_task")}
                                </Button>
                                {onJumpToMessage ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-describedby={titleId}
                                    onClick={() => jumpTo(sourceId)}
                                  >
                                    <MessageSquareText aria-hidden />
                                    {t("chat.ai.catch_up_view_source")}
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-caption text-muted-foreground">{t("chat.ai.action_items_hint")}</p>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

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
