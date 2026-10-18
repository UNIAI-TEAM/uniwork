"use client";

import { CircleAlert, Bookmark, Check, Clock, Hash, House, Lock, Trash2, Users, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChatFollowUpRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatFollowUps } from "@uniwork/core/chat";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
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
import { Notice } from "../common/notice";
import { MODULE_ICONS } from "../layout/module-icons";
import {
  CHAT_EMPTY_TILE_CLASS,
  CHAT_EMPTY_TITLE_CLASS,
  CHAT_SHEET_CLASS,
  CHAT_SHEET_HEADER_CLASS,
} from "./chat-dialog-look";
import { initialOf } from "./chat-initials";
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

/** The message line: its sender (shown bold) and its text. */
function followUpMessagePreview(
  item: ChatFollowUpRecord,
  t: (key: string) => string,
): { sender: string; body: string } {
  const raw = item.message_body.trim();
  if (!raw) return { sender: "", body: t("chat.follow_up.message_missing") };
  const body =
    describeChatMediaBody(raw, {
      sticker: t("chat.media_sticker"),
      gif: t("chat.media_gif"),
      image: t("chat.media_image"),
    }) ?? deserializeMessageBodyToComposerDraft(raw);
  return { sender: item.message_sender_name.trim(), body };
}

const ROOM_GLYPH: Record<string, LucideIcon> = { workspace: House, group: Users };

/** The 20px mark before the room name: a person's initial for a DM, a slate glyph tile otherwise. */
function FollowUpRoomMark({ item, label }: { item: ChatFollowUpRecord; label: string }) {
  if (item.room_kind === "dm") return <ActorAvatar name={label} initials={initialOf(label)} size="sm" />;
  const icon =
    item.room_kind === "channel" ? (item.room_visibility === "private" ? Lock : Hash) : (ROOM_GLYPH[item.room_kind] ?? Users);
  return <IconTile icon={icon} tone="gray" variant="solid" size="xs" />;
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

type FollowUpGroupKey = FollowUpDueState | "no_due";

const GROUP_ORDER: readonly FollowUpGroupKey[] = ["overdue", "today", "upcoming", "no_due"];

/**
 * The list under its due headers — overdue, today, upcoming, no due date —
 * on the same calendar as the due pills. Each group keeps the server's
 * order; an empty group is left out.
 */
export function groupFollowUps<T extends { due_at?: string | null }>(
  items: readonly T[],
  now: Date = new Date(),
): { key: FollowUpGroupKey; items: T[] }[] {
  const buckets: Record<FollowUpGroupKey, T[]> = { overdue: [], today: [], upcoming: [], no_due: [] };
  for (const item of items) buckets[followUpDue(item.due_at, now)?.state ?? "no_due"].push(item);
  return GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({ key, items: buckets[key] }));
}

/** Each group's header: its words, colour and dot (overdue in the danger colour). */
const GROUP_HEADER: Record<FollowUpGroupKey, { labelKey: string; tone: string; dot: string }> = {
  overdue: { labelKey: "chat.follow_up.group_overdue", tone: "text-destructive", dot: "bg-destructive-solid" },
  today: { labelKey: "chat.day_today", tone: "text-warning", dot: "bg-warning-solid" },
  upcoming: { labelKey: "chat.follow_up.group_upcoming", tone: "text-muted-foreground", dot: "bg-faint-foreground" },
  no_due: { labelKey: "chat.follow_up.group_no_due", tone: "text-muted-foreground", dot: "bg-faint-foreground" },
};

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

const DUE_ICON: Record<FollowUpDueState, LucideIcon> = { overdue: CircleAlert, today: Clock, upcoming: Clock };

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
  const Icon = DUE_ICON[due.state];
  return (
    <time
      dateTime={new Date(due.ts).toISOString()}
      title={formatMessageDateTime(due.ts, locale)}
      data-due-state={due.state}
      className={cn(
        "inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full px-2 text-caption font-semibold tabular-nums",
        DUE_TONE[due.state],
      )}
    >
      <Icon aria-hidden className="size-3" />
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
        <div key={w} className="space-y-2 rounded-xl border border-border bg-surface px-3.5 py-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className={cn("h-3.5", w)} />
          <div className="flex gap-1.5 pt-1">
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A row action: a small pill (32px), the label beside its glyph. */
const ROW_PILL = "h-8 gap-1.5 rounded-full px-3 text-label font-semibold";

/** The server's page size for this list; there is no cursor, so the sheet says when it is full. */
const FOLLOW_UP_LIMIT = 50;

/** A row action: resolves true once it succeeded, so focus can move off a row that is about to leave. */
type RowAction<T> = (arg: T) => Promise<boolean> | void;

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
  onComplete: RowAction<string>;
  onConvert: RowAction<string>;
  /** Gets the whole record so the caller can offer an undo that recreates it. */
  onDelete: RowAction<ChatFollowUpRecord>;
  /** Rows with an action in flight; only those rows hold still. */
  pendingIds?: ReadonlySet<string>;
}) {
  const { t, i18n } = useTranslation();
  const { data: followUps = [], isLoading, isError, refetch } = useChatFollowUps(
    workspaceId,
    { include_completed: false, limit: FOLLOW_UP_LIMIT },
    open,
  );
  const idBase = useId();
  const headingId = `${idBase}-title`;
  const rowId = (id: string) => `${idBase}-row-${id}`;
  const groups = groupFollowUps(followUps);
  // Rows in the order they are drawn, for the focus hand-off below.
  const drawn = groups.flatMap((group) => group.items);

  // After a row is done, converted or removed it leaves the list; focus goes
  // to the row below (or above, at the end), else to the sheet's heading —
  // never lost on a button that no longer exists.
  const afterRowAction = (itemId: string, action: Promise<boolean> | void) => {
    void Promise.resolve(action).then((ok) => {
      if (!ok) return;
      const index = drawn.findIndex((entry) => entry.id === itemId);
      const neighbour = drawn[index + 1] ?? drawn[index - 1];
      const target = neighbour
        ? document.getElementById(rowId(neighbour.id))?.querySelector<HTMLElement>("button")
        : null;
      (target ?? document.getElementById(headingId))?.focus();
    });
  };

  let body: ReactNode;
  if (isLoading) {
    body = <FollowUpListSkeleton label={t("chat.follow_up.loading")} />;
  } else if (isError) {
    body = (
      <Notice
        tone="destructive"
        icon={CircleAlert}
        layout="inline"
        live="assertive"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8.5 rounded-full px-3.5 font-semibold"
            onClick={() => void refetch()}
          >
            {t("common.retry")}
          </Button>
        }
      >
        {t("chat.follow_up.load_failed")}
      </Notice>
    );
  } else if (followUps.length === 0) {
    body = (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia>
            <IconTile icon={Bookmark} tone="brand" size="lg" className={CHAT_EMPTY_TILE_CLASS} />
          </EmptyMedia>
          <EmptyTitle className={CHAT_EMPTY_TITLE_CLASS}>{t("chat.follow_up.empty")}</EmptyTitle>
          <EmptyDescription className="max-w-80">{t("chat.follow_up.empty_hint")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    body = (
      <>
        <div className="space-y-4.5">
          {groups.map((group) => {
            const header = GROUP_HEADER[group.key];
            const groupHeadingId = `${idBase}-group-${group.key}`;
            return (
              <section key={group.key} aria-labelledby={groupHeadingId} className="space-y-2">
                <h3
                  id={groupHeadingId}
                  className={cn(
                    "ml-1 flex items-center gap-1.5 text-caption font-semibold tracking-wider uppercase",
                    header.tone,
                  )}
                >
                  <span aria-hidden className={cn("size-1.5 rounded-full", header.dot)} />
                  {t(header.labelKey)}
                </h3>
                <ul className="space-y-2">
                  {group.items.map((item) => {
                    const roomLabel = followUpRoomLabel(item, t);
                    const { sender, body: preview } = followUpMessagePreview(item, t);
                    const note = item.note.trim();
                    const pending = pendingIds?.has(item.id) ?? false;
                    return (
                      <li
                        key={item.id}
                        id={rowId(item.id)}
                        aria-busy={pending || undefined}
                        className="rounded-xl border border-border bg-surface px-3.5 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <FollowUpRoomMark item={item} label={roomLabel} />
                          <p className="min-w-0 flex-1 truncate text-label font-semibold text-muted-foreground">
                            {roomLabel}
                          </p>
                          <FollowUpDuePill dueAt={item.due_at} locale={i18n.language} />
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-body text-foreground">
                          {sender ? <strong className="font-semibold">{`${sender}: `}</strong> : null}
                          {preview}
                        </p>
                        {note ? (
                          <p className="mt-1 line-clamp-2 text-label text-muted-foreground">
                            {t("chat.follow_up.note", { note })}
                          </p>
                        ) : null}
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className={ROW_PILL}
                            disabled={pending}
                            onClick={() => afterRowAction(item.id, onComplete(item.id))}
                          >
                            <Check className="size-3.5" aria-hidden />
                            {t("chat.follow_up.complete")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className={ROW_PILL}
                            disabled={pending}
                            onClick={() => afterRowAction(item.id, onConvert(item.id))}
                          >
                            <MODULE_ICONS.tasks className="size-3.5" aria-hidden />
                            {t("chat.follow_up.convert")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn(ROW_PILL, "ml-auto text-destructive hover:text-destructive")}
                            disabled={pending}
                            onClick={() => afterRowAction(item.id, onDelete(item))}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            {t("chat.follow_up.delete")}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        {followUps.length >= FOLLOW_UP_LIMIT ? (
          <p className="px-1 pt-3 text-caption text-muted-foreground">
            {t("chat.follow_up.list_capped", { limit: FOLLOW_UP_LIMIT })}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" closeLabel={t("common.close")} className={CHAT_SHEET_CLASS}>
        <SheetHeader className={CHAT_SHEET_HEADER_CLASS}>
          <div className="flex items-center gap-3">
            <IconTile icon={Bookmark} tone="brand" size="md" className="size-9" />
            <SheetTitle id={headingId} tabIndex={-1}>
              {t("chat.follow_up.list_title")}
            </SheetTitle>
          </div>
          <SheetDescription className="pl-12">{t("chat.follow_up.list_description")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted px-4 py-4">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
