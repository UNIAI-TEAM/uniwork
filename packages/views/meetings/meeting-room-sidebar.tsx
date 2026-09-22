"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingRoomChatTab } from "./meeting-room-chat-tab";
import { MeetingRoomCopilotTab } from "./meeting-room-copilot-tab";
import { MeetingRoomFilesTab } from "./meeting-room-files-tab";
import { MeetingRoomPeopleTab } from "./meeting-room-people-tab";
import { MeetingUnderlineTabBadge, MeetingUnderlineTabs } from "./meeting-underline-tabs";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export type MeetingSidebarTab = "copilot" | "chat" | "participants" | "recordings";

const SIDEBAR_TABS: MeetingSidebarTab[] = ["copilot", "chat", "participants", "recordings"];

const PANEL_CLASS = "mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-3";

/**
 * The wide-screen dock around the side panel. Closed, it stays mounted (the
 * chat draft and scroll survive) but leaves the page: `hidden` drops it from
 * layout at once, with no width animation reflowing the video grid, and
 * `inert` keeps its controls out of the tab order. Opened by the viewer, it
 * hands focus to the active tab so the keyboard lands where the eye does.
 */
export function MeetingSidebarDock({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) {
      ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <div
      ref={ref}
      inert={!open}
      data-testid="meeting-sidebar-dock"
      className={cn(open ? "flex" : "hidden", className)}
    >
      {children}
    </div>
  );
}

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
  const baseId = useId();
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
      case "recordings":
        return t("meetings.recordingsTab");
    }
  }

  const panelId = (id: MeetingSidebarTab) => `${baseId}-panel-${id}`;
  const sidebarTabs = guestMode
    ? SIDEBAR_TABS.filter((id) => id !== "copilot")
    : SIDEBAR_TABS;
  const activeTab = sidebarTabs.includes(tab) ? tab : (sidebarTabs[0] ?? "chat");

  function panelContent(id: MeetingSidebarTab): ReactNode {
    switch (id) {
      case "copilot":
        return meetingId ? (
          <MeetingRoomCopilotTab
            meetingId={meetingId}
            workspaceId={guestMode ? undefined : workspaceId}
            canHost={canHost === true}
          />
        ) : (
          <p className="text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
        );
      case "chat":
        return <MeetingRoomChatTab meetingId={meetingId} />;
      case "participants":
        return (
          <MeetingRoomPeopleTab
            meetingId={meetingId}
            meeting={meeting}
            workspaceId={workspaceId}
            canHost={canHost}
            guestMode={guestMode}
          />
        );
      case "recordings":
        return meetingId ? (
          <MeetingRoomFilesTab meetingId={meetingId} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-hover px-4 py-8 text-center">
            <p className="text-label text-pretty text-muted-foreground">{t("meetings.recordingsEmpty")}</p>
          </div>
        );
    }
  }

  return (
    <aside className={cn("flex min-h-0 min-w-0 w-full flex-col bg-surface", className)}>
      <div className="relative z-10 shrink-0 px-2 pt-2 pb-0">
        <MeetingUnderlineTabs
          tabs={sidebarTabs}
          value={activeTab}
          onChange={onTabChange}
          label={tabLabel}
          panelId={panelId}
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

      <div
        role="tabpanel"
        id={panelId(activeTab)}
        aria-label={tabLabel(activeTab)}
        className={PANEL_CLASS}
      >
        {panelContent(activeTab)}
      </div>
    </aside>
  );
}
