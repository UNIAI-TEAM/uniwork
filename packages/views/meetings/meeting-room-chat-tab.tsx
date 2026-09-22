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
import { groupChatMessages, type MeetingChatItem } from "./meeting-chat";
import { MeetingSectionError, MeetingSectionLoading } from "./meeting-section-state";
import { useEphemeralMeetingRoomChat } from "./use-ephemeral-meeting-room-chat";
import { usePersistedMeetingRoomChat } from "./use-persisted-meeting-room-chat";

function formatChatTime(timestamp: number, locale: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

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

  const groups = groupChatMessages(items);
  const lastIncoming = [...items].reverse().find((m) => !m.isLocal);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [items.length, groups.length]);

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
        ) : groups.length === 0 ? (
          <li className="text-caption text-muted-foreground">{t("meetings.chatEmpty")}</li>
        ) : (
          groups.map((group) => (
            <li
              key={`${group.fromIdentity}-${group.items[0]?.id ?? ""}`}
              className={cn(
                "flex w-full flex-col gap-1.5",
                group.isLocal ? "items-end" : "items-start",
              )}
            >
              <div
                className={cn(
                  "flex max-w-full items-center gap-1.5 px-0.5",
                  group.isLocal && "flex-row-reverse",
                )}
              >
                {group.isLocal ? (
                  <span className="rounded-full bg-brand-subtle px-1.5 py-px text-caption font-medium text-brand-subtle-foreground">
                    {t("meetings.you")}
                  </span>
                ) : null}
                <span className="min-w-0 truncate text-caption font-medium text-foreground">
                  {group.fromName}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                  {formatChatTime(group.items[0]?.timestamp ?? 0, i18n.language)}
                </span>
              </div>
              <div
                className={cn(
                  "flex w-full flex-col gap-1",
                  group.isLocal ? "items-end" : "items-start",
                )}
              >
                {group.items.map((msg) => (
                  <p
                    key={msg.id}
                    className={cn(
                      "w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-pretty text-body wrap-break-word",
                      group.isLocal
                        ? "rounded-br-md bg-brand text-brand-foreground"
                        : "rounded-bl-md bg-muted text-foreground",
                    )}
                  >
                    {msg.message}
                  </p>
                ))}
              </div>
            </li>
          ))
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

export function MeetingRoomChatTab({
  meetingId,
}: {
  meetingId?: string;
  guestMode?: boolean;
}) {
  if (!meetingId) {
    return <EphemeralMeetingRoomChatTab />;
  }
  return <PersistedMeetingRoomChatTab meetingId={meetingId} />;
}
