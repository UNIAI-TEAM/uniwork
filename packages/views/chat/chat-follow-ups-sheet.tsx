"use client";

import { Bookmark, Check, ListTodo, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChatFollowUpRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatFollowUps } from "@uniwork/core/chat";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@uniwork/ui/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";
import { formatMessageDateTime, formatMessageTime, messageDayKey } from "./chat-message-time";
import { describeChatMediaBody } from "./chat-expression-utils";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";

function followUpRoomLabel(
  item: ChatFollowUpRecord,
  t: (key: string) => string,
): string {
  switch (item.room_kind) {
    case "workspace":
      return t("chat.workspace_room");
    case "dm":
      return item.peer_display_name.trim() || item.room_name.trim() || t("chat.follow_up.unknown_room");
    case "channel": {
      const name = item.room_name.trim().replace(/^#/, "");
      if (!name) return t("chat.follow_up.unknown_room");
      return item.room_visibility === "private" ? name : `#${name}`;
    }
    case "group":
      return item.room_name.trim() || t("chat.follow_up.unknown_room");
    default:
      return (
        item.room_name.trim() ||
        item.peer_display_name.trim() ||
        t("chat.follow_up.unknown_room")
      );
  }
}

function followUpMessagePreview(
  item: ChatFollowUpRecord,
  t: (key: string) => string,
): string {
  const raw = item.message_body.trim();
  if (!raw) return t("chat.follow_up.message_missing");
  const body =
    describeChatMediaBody(raw, {
      sticker: t("chat.media_sticker"),
      gif: t("chat.media_gif"),
      image: t("chat.media_image"),
    }) ?? deserializeMessageBodyToComposerDraft(raw);
  const sender = item.message_sender_name.trim();
  return sender ? `${sender}: ${body}` : body;
}

type FollowUpDueState = "overdue" | "today" | "upcoming";

/**
 * Where a due date stands against now, on the viewer's calendar: past the
 * moment is overdue, later today is today, anything after is upcoming.
 */
export function followUpDue(
  dueAt: string | null | undefined,
  now: Date = new Date(),
): { state: FollowUpDueState; ts: number } | null {
  if (!dueAt) return null;
  const ts = Date.parse(dueAt);
  if (Number.isNaN(ts)) return null;
  if (ts < now.getTime()) return { state: "overdue", ts };
  if (messageDayKey(ts) === messageDayKey(now.getTime())) return { state: "today", ts };
  return { state: "upcoming", ts };
}

/** "12 thg 9" / "Sep 12"; the year only when it is not this year; the time when it is today. */
function formatDueDate(ts: number, locale: string, now: Date): string {
  if (messageDayKey(ts) === messageDayKey(now.getTime())) return formatMessageTime(ts, locale);
  const date = new Date(ts);
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

const DUE_TONE: Record<FollowUpDueState, string> = {
  overdue: "bg-destructive-soft text-destructive-soft-foreground",
  today: "bg-warning-soft text-warning-soft-foreground",
  upcoming: "bg-muted text-muted-foreground",
};

function FollowUpDuePill({ dueAt, locale }: { dueAt: string | null | undefined; locale: string }) {
  const { t } = useTranslation();
  const now = new Date();
  const due = followUpDue(dueAt, now);
  if (!due) return null;
  const date = formatDueDate(due.ts, locale, now);
  const label =
    due.state === "overdue"
      ? t("chat.follow_up.overdue", { date })
      : due.state === "today"
        ? t("chat.follow_up.due_today", { time: date })
        : t("chat.follow_up.due", { date });
  return (
    <time
      dateTime={new Date(due.ts).toISOString()}
      title={formatMessageDateTime(due.ts, locale)}
      data-due-state={due.state}
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-micro font-semibold tabular-nums",
        DUE_TONE[due.state],
      )}
    >
      {label}
    </time>
  );
}

/** Follow-ups are loading: cards in their own shape. */
function FollowUpListSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2" aria-busy>
      <span className="sr-only">{label}</span>
      {["w-3/4", "w-2/3", "w-4/5"].map((w) => (
        <div key={w} className="space-y-2 rounded-lg border border-border px-3 py-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className={cn("h-3.5", w)} />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Personal FollowUps list for the workspace (open items by default). */
export function ChatFollowUpsSheet({
  open,
  onOpenChange,
  workspaceId,
  onComplete,
  onConvert,
  onDelete,
  pendingIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onComplete: (followUpId: string) => void;
  onConvert: (followUpId: string) => void;
  /** Gets the whole record so the caller can offer an undo that recreates it. */
  onDelete: (item: ChatFollowUpRecord) => void;
  /** Rows with an action in flight; only those rows hold still. */
  pendingIds?: ReadonlySet<string>;
}) {
  const { t, i18n } = useTranslation();
  const { data: followUps = [], isLoading, isError, refetch } = useChatFollowUps(
    workspaceId,
    { include_completed: false, limit: 50 },
    open,
  );

  let body: ReactNode;
  if (isLoading) {
    body = <FollowUpListSkeleton label={t("chat.follow_up.loading")} />;
  } else if (isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2 px-1">
        <p className="text-body text-destructive">{t("chat.follow_up.load_failed")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          {t("chat.retry")}
        </Button>
      </div>
    );
  } else if (followUps.length === 0) {
    body = (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia>
            <IconTile icon={Bookmark} tone={moduleTone("chat")} size="lg" />
          </EmptyMedia>
          <EmptyTitle>{t("chat.follow_up.empty")}</EmptyTitle>
          <EmptyDescription className="text-caption">{t("chat.follow_up.empty_hint")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    body = (
      <ul className="space-y-2">
        {followUps.map((item) => {
          const roomLabel = followUpRoomLabel(item, t);
          const preview = followUpMessagePreview(item, t);
          const note = item.note.trim();
          const pending = pendingIds?.has(item.id) ?? false;
          return (
            <li
              key={item.id}
              aria-busy={pending || undefined}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
            >
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-caption font-medium text-muted-foreground">
                  {roomLabel}
                </p>
                <FollowUpDuePill dueAt={item.due_at} locale={i18n.language} />
              </div>
              <p className="mt-1 line-clamp-2 text-body text-foreground">{preview}</p>
              {note ? (
                <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">
                  {t("chat.follow_up.note", { note })}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2"
                  disabled={pending}
                  onClick={() => onComplete(item.id)}
                >
                  <Check className="size-3.5" aria-hidden />
                  {t("chat.follow_up.complete")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2"
                  disabled={pending}
                  onClick={() => onConvert(item.id)}
                >
                  <ListTodo className="size-3.5" aria-hidden />
                  {t("chat.follow_up.convert")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-8 gap-1 px-2 text-destructive hover:text-destructive"
                  disabled={pending}
                  onClick={() => onDelete(item)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {t("chat.follow_up.delete")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t("chat.follow_up.list_title")}</SheetTitle>
          <SheetDescription>{t("chat.follow_up.list_description")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
