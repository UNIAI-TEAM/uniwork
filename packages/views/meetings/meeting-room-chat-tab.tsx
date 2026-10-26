"use client";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingChat, useOlderMeetingChat } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";
import { CHAT_BUBBLE_OWN } from "../chat/chat-message-row";
import { formatMessageDay, formatMessageTime, messageDayKey } from "../chat/chat-message-time";
import { senderNameClass } from "../chat/sender-colors";
import { INPUT_TYPE, ROUND } from "./meeting-copilot/meeting-composer";
import { groupChatMessages, type MeetingChatGroup, type MeetingChatItem } from "./meeting-chat";
import { MeetingFeedLoadOlder } from "./meeting-feed-load-older";
import { MeetingPersonAvatar } from "./meeting-person";
import { useRoomAvatarOf } from "./meeting-room-avatars";
import { MeetingSectionError, MeetingSectionLoading } from "./meeting-section-state";
import { useEphemeralMeetingRoomChat } from "./use-ephemeral-meeting-room-chat";
import { usePersistedMeetingRoomChat } from "./use-persisted-meeting-room-chat";

/** How close to the bottom (px) still counts as "reading the latest". */
const STICK_THRESHOLD = 48;

/* Alternating sides so the loading shape reads as a conversation. */
const BUBBLES: Array<{ own: boolean; size: string }> = [
  { own: false, size: "h-9 w-40" },
  { own: true, size: "h-9 w-32" },
  { own: false, size: "h-14 w-48" },
];

function MeetingRoomChatSkeleton() {
  return (
    <MeetingSectionLoading className="space-y-4">
      {BUBBLES.map((b, i) => (
        <div key={i} className={cn("flex flex-col gap-1.5", b.own ? "items-end" : "items-start")}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className={cn("max-w-[85%] rounded-2xl", b.size)} />
        </div>
      ))}
    </MeetingSectionLoading>
  );
}

/** The Chat board's bubble: 16px corners, 4px at the top on the sender's side for a run's first, 6px where a run's bubbles meet. */
function bubbleShape(own: boolean, first: boolean, last: boolean): string {
  if (own) return cn("rounded-2xl", first ? "rounded-tr-[4px]" : "rounded-tr-[6px]", !last && "rounded-br-[6px]");
  return cn("rounded-2xl", first ? "rounded-tl-[4px]" : "rounded-tl-[6px]", !last && "rounded-bl-[6px]");
}

const EDGE_RADIUS = { "--ai-edge-radius": "16px" } as CSSProperties;

type ChatLoadState = { loading: boolean; failed: boolean; retry: () => void };

type ChatOlderState = { hasOlder: boolean; loading: boolean; load: () => Promise<void> };

type ChatDay = { day: number; groups: MeetingChatGroup[] };

/** Messages by calendar day, then by consecutive sender within the day. */
function chatDays(items: MeetingChatItem[]): ChatDay[] {
  const days: { day: number; items: MeetingChatItem[] }[] = [];
  for (const item of items) {
    const day = messageDayKey(item.timestamp);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days.map((d) => ({ day: d.day, groups: groupChatMessages(d.items) }));
}

function MeetingRoomChatView({
  items,
  send,
  isSending,
  load,
  older,
}: {
  items: MeetingChatItem[];
  send: (message: string) => Promise<void>;
  isSending: boolean;
  load?: ChatLoadState;
  older?: ChatOlderState;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState("");
  const avatarOf = useRoomAvatarOf();
  const listRef = useRef<HTMLOListElement>(null);
  const sendLock = useRef(false);
  // Follow new messages only while the reader is at the bottom; someone who
  // scrolled up to read history keeps their place.
  const stickToBottom = useRef(true);

  const days = chatDays(items);
  // A meeting is one day: the divider only earns its row once the chat crosses midnight.
  const showDays = days.length > 1;
  const groupCount = days.reduce((n, d) => n + d.groups.length, 0);
  const lastIncoming = [...items].reverse().find((m) => !m.isLocal);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [items.length, groupCount]);

  // Older messages go above what the reader is looking at; keep it in place.
  async function loadOlder() {
    const list = listRef.current;
    const fromBottom = list ? list.scrollHeight - list.scrollTop : 0;
    await older?.load();
    requestAnimationFrame(() => {
      if (list) list.scrollTop = list.scrollHeight - fromBottom;
    });
  }

  async function onSend(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sendLock.current || isSending) return;
    sendLock.current = true;
    try {
      await send(body);
      setDraft("");
      stickToBottom.current = true;
    } catch (err) {
      toastApiError(err, t("common.error"));
    } finally {
      sendLock.current = false;
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter that confirms an IME composition (Telex, VNI) is not a send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  }

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {lastIncoming ? `${lastIncoming.fromName}: ${lastIncoming.message}` : ""}
      </p>
      <ol
        ref={listRef}
        // On top of the panel's own px-3 pt-2: the board's 14px sides and 16px top.
        className="min-h-0 w-full flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-0.5 py-2"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
        }}
      >
        {older?.hasOlder ? (
          <li>
            <MeetingFeedLoadOlder label={t("meetings.chatLoadOlder")} loading={older.loading} onLoad={loadOlder} />
          </li>
        ) : null}
        {load?.loading ? (
          <li>
            <MeetingRoomChatSkeleton />
          </li>
        ) : load?.failed ? (
          <li>
            <MeetingSectionError message={t("meetings.chatLoadFailed")} onRetry={load.retry} />
          </li>
        ) : days.length === 0 ? (
          <li className="text-caption text-muted-foreground">{t("meetings.chatEmpty")}</li>
        ) : (
          days.flatMap((day) => [
            showDays ? (
              <li
                key={`day-${day.day}`}
                className="flex items-center gap-2 text-caption font-medium text-muted-foreground"
              >
                <span aria-hidden className="h-px flex-1 bg-border" />
                {formatMessageDay(day.day, i18n.language, {
                  today: t("meetings.today"),
                  yesterday: t("meetings.yesterday"),
                })}
                <span aria-hidden className="h-px flex-1 bg-border" />
              </li>
            ) : null,
            ...day.groups.map((group) => (
              <li
                key={`${group.fromIdentity}-${group.items[0]?.id ?? ""}`}
                className={cn("flex w-full gap-2", group.isLocal && "flex-row-reverse")}
              >
                {group.isLocal ? null : (
                  <MeetingPersonAvatar name={group.fromName} avatarUrl={avatarOf(group.fromIdentity)} size={28} />
                )}
                <div
                  className={cn(
                    "flex min-w-0 flex-1 flex-col gap-0.75",
                    group.isLocal ? "items-end" : "items-start",
                  )}
                >
                  <div className="flex max-w-full items-baseline gap-1.5">
                    {group.isLocal ? null : (
                      <span
                        className={cn(
                          "min-w-0 truncate text-caption font-semibold",
                          senderNameClass(group.fromIdentity, group.isLocal),
                        )}
                      >
                        {group.fromName}
                      </span>
                    )}
                    <span className="shrink-0 text-micro tabular-nums text-faint-foreground">
                      {formatMessageTime(group.items[0]?.timestamp ?? 0, i18n.language)}
                    </span>
                  </div>
                  {group.items.map((msg, index) => (
                    <p
                      key={msg.id}
                      className={cn(
                        "w-fit max-w-[85%] whitespace-pre-wrap px-3 py-2 text-pretty text-body text-foreground wrap-break-word",
                        bubbleShape(group.isLocal, index === 0, index === group.items.length - 1),
                        group.isLocal ? CHAT_BUBBLE_OWN : "bg-surface-hover",
                      )}
                    >
                      {msg.message}
                    </p>
                  ))}
                </div>
              </li>
              )),
          ])
        )}
      </ol>
      <div className="ai-edge mt-2 w-full shrink-0" style={EDGE_RADIUS}>
        <form className="flex items-end gap-1.5 py-1.25 pr-1.25 pl-3" onSubmit={onSend}>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={t("meetings.chatPlaceholder")}
            aria-label={t("meetings.chat")}
            className={cn(
              "max-h-32 min-h-8 resize-none rounded-none border-0 bg-transparent px-0 py-1.25 focus-visible:ring-0 dark:bg-transparent",
              INPUT_TYPE,
            )}
          />
          <Button
            type="submit"
            aria-disabled={isSending || !draft.trim() || undefined}
            aria-label={t("meetings.send")}
            className={cn(
              ROUND,
              isSending || !draft.trim()
                ? "bg-surface-hover text-faint-foreground"
                : "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            <ArrowUp aria-hidden />
          </Button>
        </form>
      </div>
    </>
  );
}

function PersistedMeetingRoomChatTab({ meetingId }: { meetingId: string }) {
  const chat = usePersistedMeetingRoomChat(meetingId);
  // Same query key as the hook above, so this only reads its status.
  const { data, isPending, isError, refetch } = useMeetingChat(meetingId);
  const { hasOlder, loadOlder, isLoadingOlder } = useOlderMeetingChat(meetingId);
  const load: ChatLoadState = {
    loading: isPending,
    failed: isError && !data,
    retry: () => void refetch(),
  };
  const older: ChatOlderState = { hasOlder, loading: isLoadingOlder, load: loadOlder };
  return <MeetingRoomChatView {...chat} load={load} older={older} />;
}

function EphemeralMeetingRoomChatTab() {
  const chat = useEphemeralMeetingRoomChat();
  return <MeetingRoomChatView {...chat} />;
}

export function MeetingRoomChatTab({ meetingId }: { meetingId?: string }) {
  if (!meetingId) {
    return <EphemeralMeetingRoomChatTab />;
  }
  return <PersistedMeetingRoomChatTab meetingId={meetingId} />;
}
