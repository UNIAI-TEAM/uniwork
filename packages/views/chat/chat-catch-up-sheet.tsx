"use client";

import { useId, useState } from "react";
import { CircleAlert, CircleCheck, RotateCcwClock, ListChecks, MessageSquareText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatCatchUpActionItem, ChatCatchUpHighlight, ChatCatchUpResponse } from "@uniwork/core/types";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Notice } from "../common/notice";
import {
  CHAT_EMPTY_TILE_CLASS,
  CHAT_EMPTY_TITLE_CLASS,
  CHAT_PILL_SM_CLASS,
  CHAT_SHEET_CLASS,
  CHAT_SHEET_HEADER_CLASS,
} from "./chat-dialog-look";
import { formatMessageDateTime, formatMessageTime } from "./chat-message-time";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";
import { catchUpGeneratedAt } from "./use-chat-catch-up-ui";

/** Highlights with their source message; a server that predates highlight_items sends only the strings. */
function briefHighlights(result: ChatCatchUpResponse): ChatCatchUpHighlight[] {
  if (result.highlight_items.length > 0) return result.highlight_items;
  return result.highlights.map((text) => ({ text, source_message_id: "" }));
}

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

/** Placeholder in the brief's shape (summary lines, list rows) under a line saying UNI is reading. */
function CatchUpSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-body text-foreground">
        <Spinner className="text-brand" />
        {label}
      </p>
      <div aria-hidden className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-3.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-10 w-full rounded-lg" />
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
  const highlights = result ? briefHighlights(result) : [];

  const jumpTo = (messageId: string) => {
    onOpenChange(false);
    onJumpToMessage?.(messageId);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          closeLabel={t("common.close")}
          className={CHAT_SHEET_CLASS}
        >
          <SheetHeader className={CHAT_SHEET_HEADER_CLASS}>
            <SheetTitle className="flex items-center gap-3">
              <IconTile icon={RotateCcwClock} tone="brand" size="md" className="size-9" />
              {t("chat.ai.catch_up_title")}
            </SheetTitle>
            <SheetDescription className="pl-12">
              {result?.mode === "recent"
                ? t("chat.ai.catch_up_description_recent")
                : t("chat.ai.catch_up_description")}
            </SheetDescription>
          </SheetHeader>

          {!loading && error ? (
            <Notice
              tone="destructive"
              icon={CircleAlert}
              live="assertive"
              action={
                onRetry ? (
                  <Button type="button" variant="outline" size="sm" className={CHAT_PILL_SM_CLASS} onClick={onRetry}>
                    {t("common.retry")}
                  </Button>
                ) : undefined
              }
            >
              <p>{failedTitle}</p>
              {errorDetail ? <p className="font-normal">{errorDetail}</p> : null}
            </Notice>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
            {loading ? <CatchUpSkeleton label={t("chat.ai.catch_up_loading")} /> : null}

            {!loading && !error && empty ? (
              <div
                className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
                role="status"
              >
                <IconTile icon={CircleCheck} size="lg" tone="success" className={CHAT_EMPTY_TILE_CLASS} />
                <div className="flex max-w-80 flex-col gap-1.5">
                  <p className={CHAT_EMPTY_TITLE_CLASS}>{t("chat.ai.catch_up_empty_title")}</p>
                  <p className="text-body text-muted-foreground">{t("chat.ai.catch_up_empty")}</p>
                </div>
              </div>
            ) : null}

            {!loading && !error && result && !empty ? (
              <div className="flex flex-col gap-5">
                <section className="flex flex-col gap-2.5" aria-labelledby={`${idBase}-attribution`}>
                  <p
                    id={`${idBase}-attribution`}
                    className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-muted-foreground tabular-nums"
                  >
                    <IconTile icon={Sparkles} size="xs" tone="brand" />
                    <span className="font-semibold text-foreground">{t("chat.ai.catch_up_attribution")}</span>
                    {stamp ? (
                      <time dateTime={new Date(stamp).toISOString()} title={formatMessageDateTime(stamp, locale)}>
                        {t("chat.ai.catch_up_generated_at", { time: formatBriefTime(stamp, locale) })}
                      </time>
                    ) : null}
                    {result.message_count > 0 ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{t("chat.ai.message_count", { count: result.message_count })}</span>
                      </>
                    ) : null}
                    {since ? (
                      <>
                        <span aria-hidden>·</span>
                        <time dateTime={new Date(since).toISOString()} title={formatMessageDateTime(since, locale)}>
                          {t("chat.ai.catch_up_since", { time: formatBriefTime(since, locale) })}
                        </time>
                      </>
                    ) : null}
                  </p>
                  {/* The AI's words sit on the brand wash, apart from the room's own messages. */}
                  <div className="rounded-xl border border-brand/25 bg-brand-subtle/50 px-4 py-3.5">
                    <p className="whitespace-pre-wrap text-body-lg text-foreground">{result.summary}</p>
                  </div>
                </section>

                {highlights.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <SectionLabel>{t("chat.ai.highlights")}</SectionLabel>
                    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                      {highlights.map((h, index) => {
                        const sourceId = h.source_message_id;
                        const textId = `${idBase}-highlight-${index}`;
                        return (
                          <li
                            key={`${h.text}-${sourceId}-${index}`}
                            className="flex gap-2.5 px-3.5 py-2.5 text-body text-foreground"
                          >
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                            <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                              <span id={textId}>{h.text}</span>
                              {sourceId && onJumpToMessage ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className={CHAT_PILL_SM_CLASS}
                                  aria-describedby={textId}
                                  onClick={() => jumpTo(sourceId)}
                                >
                                  <MessageSquareText aria-hidden />
                                  {t("chat.ai.catch_up_view_source")}
                                </Button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
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
                            className="rounded-xl border border-border bg-surface px-3.5 py-3"
                          >
                            <p id={titleId} className="text-body-lg font-semibold text-foreground">
                              {item.title}
                            </p>
                            {item.owner || item.due ? (
                              <p className="mt-0.5 text-label text-muted-foreground">
                                {[item.owner, item.due].filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                            {sourceId ? (
                              <div className="mt-2.5 flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="brandSubtle"
                                  size="sm"
                                  className={CHAT_PILL_SM_CLASS}
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
                                    className={CHAT_PILL_SM_CLASS}
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
