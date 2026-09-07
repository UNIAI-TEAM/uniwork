"use client";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Sparkles } from "lucide-react";
import { MeetingRoomChatTab } from "./meeting-room-chat-tab";
import { MeetingRoomCopilotTab } from "./meeting-room-copilot-tab";
import { MeetingRoomFilesTab } from "./meeting-room-files-tab";
import { MeetingRoomPeopleTab } from "./meeting-room-people-tab";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export type MeetingSidebarTab = "copilot" | "chat" | "participants" | "files";

const SIDEBAR_TABS: MeetingSidebarTab[] = ["copilot", "chat", "participants", "files"];

const MEETING_SIDEBAR_TAB_TRIGGER =
  "relative flex min-h-10 items-center justify-center overflow-hidden rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 py-2 shadow-none after:!hidden h-auto flex-none text-caption font-medium leading-tight whitespace-normal text-center transition-[color,border-color] duration-200 data-active:!border-brand data-active:!bg-transparent data-active:!font-semibold data-active:!text-brand data-active:!shadow-none dark:data-active:!border-brand dark:data-active:!bg-transparent hover:text-foreground text-muted-foreground";

export function MeetingRoomSidebar({
  meetingId,
  meeting,
  workspaceId,
  canHost,
  guestMode,
  className,
  tab,
  onTabChange,
}: {
  meetingId?: string;
  meeting?: Meeting;
  workspaceId?: string;
  canHost?: boolean;
  guestMode?: boolean;
  className?: string;
  tab: MeetingSidebarTab;
  onTabChange: (tab: MeetingSidebarTab) => void;
}) {
  const { t } = useTranslation();
  const { count: pendingJoinCount } = usePendingJoinRequests(
    canHost && meetingId ? meetingId : undefined,
  );

  function tabLabel(id: MeetingSidebarTab): string {
    switch (id) {
      case "copilot":
        return t("meetings.aiCopilot");
      case "chat":
        return t("meetings.chat");
      case "participants":
        return t("meetings.people");
      case "files":
        return t("meetings.filesTab");
    }
  }

  const sidebarTabs = guestMode
    ? SIDEBAR_TABS.filter((id) => id !== "copilot")
    : SIDEBAR_TABS;

  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 w-full flex-col bg-surface",
        className,
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as MeetingSidebarTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 overflow-hidden border-b border-border px-2 pt-3 pb-0">
          {!guestMode ? (
            <div className="mb-2 flex items-center gap-2 px-1">
              <Sparkles aria-hidden className="size-4 text-brand" />
              <span className="text-label font-semibold text-foreground">{t("meetings.uniworkAi")}</span>
            </div>
          ) : null}
          <TabsList
            variant="line"
            className={cn(
              "grid h-auto w-full gap-0 overflow-hidden rounded-none bg-transparent p-0",
              sidebarTabs.length === 3 ? "grid-cols-3" : "grid-cols-4",
            )}
          >
            {sidebarTabs.map((id) => (
              <TabsTrigger
                key={id}
                value={id}
                title={tabLabel(id)}
                className={MEETING_SIDEBAR_TAB_TRIGGER}
              >
                <span className="inline-flex min-w-0 flex-col items-center gap-0.5 px-0.5">
                  <span className="line-clamp-2">{tabLabel(id)}</span>
                  {id === "participants" && pendingJoinCount > 0 ? (
                    <Badge
                      variant="destructive"
                      className="h-4 min-w-4 shrink-0 px-1 tabular-nums"
                      aria-label={t("meetings.joinRequestsPendingTitle", { count: pendingJoinCount })}
                    >
                      {pendingJoinCount > 9 ? "9+" : pendingJoinCount}
                    </Badge>
                  ) : null}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="copilot" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
          {meetingId ? (
            <MeetingRoomCopilotTab
              meetingId={meetingId}
              workspaceId={guestMode ? undefined : workspaceId}
              canHost={canHost === true}
            />
          ) : (
            <p className="text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
          )}
        </TabsContent>

        <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
          <MeetingRoomChatTab meetingId={meetingId} guestMode={guestMode} />
        </TabsContent>

        <TabsContent
          value="participants"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3"
        >
          <MeetingRoomPeopleTab
            meetingId={meetingId}
            meeting={meeting}
            workspaceId={workspaceId}
            canHost={canHost}
            guestMode={guestMode}
          />
        </TabsContent>

        <TabsContent value="files" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
          {meetingId ? (
            <MeetingRoomFilesTab meetingId={meetingId} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
              <p className="text-label text-muted-foreground">{t("meetings.filesEmpty")}</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
