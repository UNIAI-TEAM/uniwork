"use client";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingChat } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, chatBubbleShape } from "../chat/chat-message-row";
import { formatMessageDay, formatMessageTime, messageDayKey } from "../chat/chat-message-time";
import { senderNameClass } from "../chat/sender-colors";
import { groupChatMessages, type MeetingChatGroup, type MeetingChatItem } from "./meeting-chat";
import { MeetingPersonAvatar } from "./meeting-person";
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

type ChatLoadState = { loading: boolean; failed: boolean; retry: () => void };

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
}: {
  items: MeetingChatItem[];
  send: (message: string) => Promise<void>;
  isSending: boolean;
  load?: ChatLoadState;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const sendLock = useRef(false);
  // Follow new messages only while the reader is at the bottom; someone who
  // scrolled up to read history keeps their place.
  const stickToBottom = useRef(true);

  const days = chatDays(items);
  const groupCount = days.reduce((n, d) => n + d.groups.length, 0);
  const lastIncoming = [...items].reverse().find((m) => !m.isLocal);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [items.length, groupCount]);

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
        className="min-h-0 w-full flex-1 space-y-4 overflow-y-auto overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
        }}
      >
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
            </li>,
            ...day.groups.map((group) => (
              <li
                key={`${group.fromIdentity}-${group.items[0]?.id ?? ""}`}
                className={cn("flex w-full gap-2", group.isLocal && "flex-row-reverse")}
              >
                {group.isLocal ? null : <MeetingPersonAvatar name={group.fromName} className="mt-0.5" />}
                <div
                  className={cn(
                    "flex min-w-0 flex-1 flex-col gap-1",
                    group.isLocal ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "flex max-w-full items-baseline gap-1.5 px-0.5",
                      group.isLocal && "flex-row-reverse",
                    )}
                  >
                    <span
                      className={cn(
                        "min-w-0 truncate text-caption font-semibold",
                        senderNameClass(group.fromIdentity, group.isLocal),
                      )}
                    >
                      {group.isLocal ? t("meetings.you") : group.fromName}
                    </span>
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {formatMessageTime(group.items[0]?.timestamp ?? 0, i18n.language)}
                    </span>
                  </div>
                  {group.items.map((msg, index) => (
                    <p
                      key={msg.id}
                      className={cn(
                        "w-fit max-w-[85%] whitespace-pre-wrap px-3 py-2 text-pretty text-body text-foreground wrap-break-word",
                        chatBubbleShape(group.isLocal, index === 0),
                        group.isLocal ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
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
      <form className="relative mt-3 w-full shrink-0" onSubmit={onSend}>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t("meetings.chatPlaceholder")}
          aria-label={t("meetings.chat")}
          className="field-sizing-content max-h-32 min-h-10 resize-none rounded-2xl bg-surface py-2.5 pr-11"
        />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          disabled={isSending || !draft.trim()}
          aria-label={t("meetings.send")}
          className="absolute top-1.5 right-1.5 size-8 rounded-full"
        >
          <Send aria-hidden className="size-4" />
        </Button>
      </form>
    </>
  );
}

function PersistedMeetingRoomChatTab({ meetingId }: { meetingId: string }) {
  const chat = usePersistedMeetingRoomChat(meetingId);
  // Same query key as the hook above, so this only reads its status.
  const { data, isPending, isError, refetch } = useMeetingChat(meetingId);
  const load: ChatLoadState = {
    loading: isPending,
    failed: isError && !data,
    retry: () => void refetch(),
  };
  return <MeetingRoomChatView {...chat} load={load} />;
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
