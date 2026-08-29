"use client";
import { useState, type FormEvent } from "react";
import { useChat, useParticipants } from "@livekit/components-react";
import { Hand, MicOff, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { groupChatMessages, type MeetingChatItem } from "./meeting-chat";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingParticipantTile } from "./meeting-participant-tile";
import { useMeetingSignals } from "./use-meeting-signals";

const TAB_TRIGGER =
  "rounded-lg border border-transparent px-3 py-1.5 data-active:border-input data-active:bg-muted data-active:text-foreground data-active:shadow-none";

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
  // Raised hands float to the top, in the order they were raised.
  const ordered = [
    ...hands
      .map((h) => participants.find((p) => p.identity === h))
      .filter((p) => p !== undefined),
    ...participants.filter((p) => !hands.includes(p.identity)),
  ];
  const { chatMessages, send, isSending } = useChat();
  const [draft, setDraft] = useState("");

  const items: MeetingChatItem[] = chatMessages.map((msg) => ({
    id: `${msg.from?.identity ?? "x"}-${msg.timestamp}-${msg.message}`,
    fromIdentity: msg.from?.identity ?? "",
    fromName: msg.from?.name || msg.from?.identity || "",
    isLocal: Boolean(msg.from?.isLocal),
    message: msg.message,
    timestamp: msg.timestamp,
  }));
  const groups = groupChatMessages(items);
  const lastIncoming = [...items].reverse().find((m) => !m.isLocal);

  function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || isSending) return;
    void send(body).then(() => setDraft(""));
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
              <li key={p.identity} className="relative">
                <MeetingParticipantTile participant={p} compact />
                {canHost && !p.isLocal ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label={t("meetings.muteParticipant", {
                      name: p.name || p.identity,
                    })}
                    className="absolute bottom-1.5 left-1.5 size-7 rounded-full"
                    onClick={() => requestMute(p.identity)}
                  >
                    <MicOff aria-hidden className="size-3.5" />
                  </Button>
                ) : null}
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
          <ol className="min-h-0 w-full flex-1 space-y-4 overflow-y-auto">
            {groups.length === 0 ? (
              <li className="text-caption text-muted-foreground">
                {t("meetings.chatEmpty")}
              </li>
            ) : (
              groups.map((group) => (
                <li
                  key={`${group.fromIdentity}-${group.items[0]?.id ?? ""}`}
                  className={cn(
                    "w-full space-y-1.5",
                    group.isLocal && "flex flex-col items-end",
                  )}
                >
                  <div
                    className={cn(
                      "flex min-w-0 items-center gap-1.5",
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
                  {group.items.map((msg) => (
                    <p
                      key={msg.id}
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-1.5 text-pretty text-body wrap-break-word",
                        group.isLocal
                          ? "bg-brand text-brand-foreground"
                          : "border border-border bg-muted text-foreground",
                      )}
                    >
                      {msg.message}
                    </p>
                  ))}
                </li>
              ))
            )}
          </ol>
          <form className="relative mt-3 w-full" onSubmit={onSend}>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("meetings.chatPlaceholder")}
              aria-label={t("meetings.chat")}
              className="h-10 w-full rounded-full bg-surface pr-11"
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={isSending || !draft.trim()}
              aria-label={t("meetings.send")}
              className="absolute top-1/2 right-1 size-8 -translate-y-1/2 rounded-full"
            >
              <Send aria-hidden className="size-4" />
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
