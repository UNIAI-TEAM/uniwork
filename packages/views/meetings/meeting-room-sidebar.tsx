"use client";
import { useParticipants } from "@livekit/components-react";
import { Hand } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingParticipantTile } from "./meeting-participant-tile";
import { MeetingRoomChatTab } from "./meeting-room-chat-tab";
import { useMeetingSignals } from "./use-meeting-signals";

const TAB_TRIGGER =
  "cursor-pointer rounded-lg border border-transparent px-3 py-1.5 data-active:border-input data-active:bg-muted data-active:text-foreground data-active:shadow-none";

export function MeetingRoomSidebar({
  meetingId,
  canHost,
  guestMode,
  className,
}: {
  meetingId?: string;
  canHost?: boolean;
  guestMode?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const participants = useParticipants();
  const { hands, requestMute } = useMeetingSignals();

  // Raised hands float to the top, in the order they were raised.
  const ordered = [
    ...hands
      .map((h) => participants.find((p) => p.identity === h))
      .filter((p) => p !== undefined),
    ...participants.filter((p) => !hands.includes(p.identity)),
  ];

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
          <MeetingRoomChatTab meetingId={meetingId} guestMode={guestMode} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
