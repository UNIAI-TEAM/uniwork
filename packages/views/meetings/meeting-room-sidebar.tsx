"use client";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { Tabs, TabsContent } from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingRoomChatTab } from "./meeting-room-chat-tab";
import { MeetingRoomCopilotTab } from "./meeting-room-copilot-tab";
import { MeetingRoomFilesTab } from "./meeting-room-files-tab";
import { MeetingRoomPeopleTab } from "./meeting-room-people-tab";
import { MeetingUnderlineTabBadge, MeetingUnderlineTabs } from "./meeting-underline-tabs";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export type MeetingSidebarTab = "copilot" | "chat" | "participants" | "files";

const SIDEBAR_TABS: MeetingSidebarTab[] = ["copilot", "chat", "participants", "files"];

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
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="relative z-10 shrink-0 px-2 pt-2 pb-0">
          <MeetingUnderlineTabs
            tabs={sidebarTabs}
            value={tab}
            onChange={onTabChange}
            label={tabLabel}
            equalWidth
            badge={(id) =>
              id === "participants" && pendingJoinCount > 0 ? (
                <MeetingUnderlineTabBadge
                  aria-label={t("meetings.joinRequestsPendingTitle", { count: pendingJoinCount })}
                >
                  {pendingJoinCount > 9 ? "9+" : pendingJoinCount}
                </MeetingUnderlineTabBadge>
              ) : null
            }
          />
        </div>

        <TabsContent value="copilot" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-3">
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

        <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-3">
          <MeetingRoomChatTab meetingId={meetingId} guestMode={guestMode} />
        </TabsContent>

        <TabsContent
          value="participants"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-3"
        >
          <MeetingRoomPeopleTab
            meetingId={meetingId}
            meeting={meeting}
            workspaceId={workspaceId}
            canHost={canHost}
            guestMode={guestMode}
          />
        </TabsContent>

        <TabsContent value="files" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-3">
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
