"use client";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useParticipants } from "@livekit/components-react";
import { Hand, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { groupChatMessages } from "./meeting-chat";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingParticipantTile } from "./meeting-participant-tile";
import { useMeetingSignals } from "./use-meeting-signals";
import { useMeetingRoomChat } from "./use-meeting-room-chat";

const TAB_TRIGGER =
  "cursor-pointer rounded-lg border border-transparent px-3 py-1.5 data-active:border-input data-active:bg-muted data-active:text-foreground data-active:shadow-none";

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

export function MeetingRoomSidebar({
  meetingId,
  canHost,
  className,
}: {
  meetingId?: string;
  canHost?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const participants = useParticipants();
  const { hands, requestMute } = useMeetingSignals();
  const { items, send, isSending } = useMeetingRoomChat(meetingId);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  // Raised hands float to the top, in the order they were raised.
  const ordered = [
    ...hands
      .map((h) => participants.find((p) => p.identity === h))
      .filter((p) => p !== undefined),
    ...participants.filter((p) => !hands.includes(p.identity)),
  ];

  const groups = groupChatMessages(items);
  const lastIncoming = [...items].reverse().find((m) => !m.isLocal);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [items.length, groups.length]);

  async function onSend(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || isSending) return;
    await send(body);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  }

  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 w-full flex-col bg-surface",
        className,
      )}
    >
      <Tabs
        defaultValue="participants"
        className="flex min-h-0 w-full flex-1 flex-col gap-0 p-3"
      >
        <TabsList className="h-auto w-full gap-1 bg-transparent p-0">
          <TabsTrigger value="participants" className={TAB_TRIGGER}>
            {t("meetings.participantsTab", { count: participants.length })}
          </TabsTrigger>
          <TabsTrigger value="chat" className={TAB_TRIGGER}>
            {t("meetings.chat")}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="participants"
          className="mt-3 min-h-0 flex-1 overflow-y-auto"
        >
          {canHost && meetingId ? (
            <MeetingJoinRequestsPanel meetingId={meetingId} compact />
          ) : null}
          {hands.length > 0 ? (
            <p className="mb-2 flex items-center gap-1.5 text-caption text-muted-foreground">
              <Hand aria-hidden className="size-3.5" />
              {t("meetings.handsRaised", { count: hands.length })}
            </p>
          ) : null}
          <ul className="grid grid-cols-2 gap-2">
            {ordered.map((p) => (
              <li key={p.identity}>
                <MeetingParticipantTile
                  participant={p}
                  compact
                  onHostMuteRequest={
                    canHost && !p.isLocal ? () => requestMute(p.identity) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </TabsContent>
        <TabsContent
          value="chat"
          className="mt-3 flex min-h-0 w-full flex-1 flex-col"
        >
          {/* Screen readers hear new messages from others without the list re-announcing itself. */}
          <p className="sr-only" aria-live="polite">
            {lastIncoming
              ? `${lastIncoming.fromName}: ${lastIncoming.message}`
              : ""}
          </p>
          <ol
            ref={listRef}
            className="min-h-0 w-full flex-1 space-y-4 overflow-y-auto overscroll-contain"
          >
            {groups.length === 0 ? (
              <li className="text-caption text-muted-foreground">
                {t("meetings.chatEmpty")}
              </li>
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
                      <span className="rounded-full border border-brand/25 bg-brand/10 px-1.5 py-px text-caption font-medium text-foreground">
                        {t("meetings.you")}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-caption font-medium text-foreground">
                      {group.fromName}
                    </span>
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {formatChatTime(
                        group.items[0]?.timestamp ?? 0,
                        i18n.language,
                      )}
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
                          "w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-pretty text-body wrap-break-word shadow-sm",
                          group.isLocal
                            ? "rounded-br-md bg-brand text-brand-foreground"
                            : "rounded-bl-md border border-border/80 bg-muted/80 text-foreground",
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
        </TabsContent>
      </Tabs>
    </aside>
  );
}
