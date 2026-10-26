"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { CirclePlay, MessageCircle, PanelRightClose, Users, Vote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { motionsTabState, useMeetingMotions } from "@uniwork/core/meetings/motions";
import type { Meeting } from "@uniwork/core/types";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingMotionsList } from "./meeting-motions-list";
import { MeetingRoomChatTab } from "./meeting-room-chat-tab";
import type { MeetingFeedFilter } from "./meeting-copilot/feed-filter-chips";
import type { UniView } from "./meeting-copilot/uni-status-row";
import { MeetingRoomCopilotTab } from "./meeting-room-copilot-tab";
import { MeetingRoomPeopleTab } from "./meeting-room-people-tab";
import { MeetingRoomRecordingsTab } from "./meeting-room-recordings-tab";
import type { ScribeChipState } from "./meeting-scribe-chip";
import { RoomPanelNavigation } from "./room-panel-navigation";
import { RoomPanelTabs, type RoomPanelBadge } from "./room-panel-tabs";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export type MeetingSidebarTab = "copilot" | "chat" | "participants" | "motions" | "recordings";

const SIDEBAR_TABS: MeetingSidebarTab[] = ["copilot", "chat", "participants", "motions", "recordings"];

const PANEL_CLASS = "mt-0 flex min-h-0 flex-1 flex-col overflow-hidden";
// The UNI tab lays out its own rows edge to edge (status row, scroll area, pinned composer).
const PANEL_PADDING = "px-3 pt-2 pb-3";

/**
 * The wide-screen dock around the side panel. Closed, it stays mounted (the
 * chat draft and scroll survive) but leaves the page: `hidden` drops it from
 * layout at once, with no width animation reflowing the video grid, and
 * `inert` keeps its controls out of the tab order. Opened by the viewer, it
 * hands focus to the active tab so the keyboard lands where the eye does; a
 * new `focusRequest` does the same for a panel that is already open.
 */
export function MeetingSidebarDock({
  open,
  focusRequest = 0,
  className,
  children,
}: {
  open: boolean;
  focusRequest?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const lastRequest = useRef(focusRequest);

  useEffect(() => {
    if (open && (!wasOpen.current || focusRequest !== lastRequest.current)) {
      ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    }
    wasOpen.current = open;
    lastRequest.current = focusRequest;
  }, [open, focusRequest]);

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
  chatUnread = 0,
  tabsEnd,
  lateMinutes = null,
  onDismissCatchUp,
  scribeOn = false,
  scribeState,
  liveItemsUnseen = 0,
  liveItemIds,
  onUniViewChange,
  onCollapse,
}: {
  meetingId?: string;
  meeting?: Meeting;
  workspaceId?: string;
  canHost?: boolean;
  guestMode?: boolean;
  className?: string;
  tab: MeetingSidebarTab;
  onTabChange: (tab: MeetingSidebarTab) => void;
  /** Messages from others that arrived while the chat was off screen. */
  chatUnread?: number;
  /** Beside the tab row (the sheet's close button), so it never covers a tab. */
  tabsEnd?: ReactNode;
  /** How late this member is when late enough for the catch-up card (catchUpLateMinutes). */
  lateMinutes?: number | null;
  onDismissCatchUp?: () => void;
  /** The AI scribe is in the room. */
  scribeOn?: boolean;
  /** What the scribe is doing, for the UNI tab's status row; undefined where the workspace has no scribe. */
  scribeState?: ScribeChipState;
  /** Live items the scribe wrote that this viewer has not had on screen. */
  liveItemsUnseen?: number;
  /** Their ids, marked new in the UNI feed. */
  liveItemIds?: ReadonlySet<string>;
  onUniViewChange?: (view: UniView, filter: MeetingFeedFilter) => void;
  /** Folds the docked panel away; draws the collapse button at the end of the tab row. */
  onCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const { count: pendingJoinCount } = usePendingJoinRequests(
    canHost && meetingId ? meetingId : undefined,
  );
  // Guests (and invite-link outsiders) have no meeting row here: never clerks.
  const { isClerk } = useMeetingClerk(guestMode ? null : (meeting ?? null), workspaceId ?? "");
  const { data: motions } = useMeetingMotions(meetingId ?? "", Boolean(meetingId));
  const motionsTab = motionsTabState(motions, isClerk);
  // A member finds recordings in the UNI feed; a guest has no UNI tab, so gets a tab once one can be played.
  const { data: recordings } = useRecordings(meetingId ?? "", Boolean(guestMode));
  const guestRecordings = Boolean(guestMode) && (recordings ?? []).some((r) => r.status === "COMPLETE");

  function tabLabel(id: MeetingSidebarTab): string {
    switch (id) {
      case "copilot":
        return t("meetings.aiCopilot");
      case "chat":
        return t("meetings.chat");
      case "participants":
        return t("meetings.people");
      case "motions":
        return t("meetings.governance.motionsTab");
      case "recordings":
        return t("meetings.recordingsTab");
    }
  }

  function tabIcon(id: MeetingSidebarTab): ReactNode {
    switch (id) {
      case "copilot":
        return <ScribeMark size={18} state={scribeOn ? "live" : "idle"} />;
      case "chat":
        return <MessageCircle aria-hidden className="size-4" />;
      case "participants":
        return <Users aria-hidden className="size-4" />;
      case "motions":
        return <Vote aria-hidden className="size-4" />;
      case "recordings":
        return <CirclePlay aria-hidden className="size-4" />;
    }
  }

  function tabBadge(id: MeetingSidebarTab): RoomPanelBadge | null {
    if (id === "participants" && pendingJoinCount > 0) {
      return { tone: "attention", count: pendingJoinCount, srLabel: t("meetings.joinRequestsPendingTitle", { count: pendingJoinCount }) };
    }
    if (id === "chat" && chatUnread > 0) {
      return { tone: "info", count: chatUnread, srLabel: t("meetings.chatUnread", { count: chatUnread }) };
    }
    if (id === "copilot" && liveItemsUnseen > 0) {
      return { tone: "info", count: liveItemsUnseen, srLabel: t("meetings.liveItemsUnseen", { count: liveItemsUnseen }) };
    }
    // At most one item is open at a time: a dot, not a count.
    if (id === "motions" && motionsTab.pending) return { tone: "attention", srLabel: t("meetings.governance.votePending") };
    return null;
  }

  const panelId = (id: MeetingSidebarTab) => `${baseId}-panel-${id}`;
  // Clerks always see Votes; everyone else once something has been opened.
  const sidebarTabs = SIDEBAR_TABS.filter(
    (id) =>
      !(guestMode && id === "copilot") && (id !== "motions" || motionsTab.visible) && (id !== "recordings" || guestRecordings),
  );
  const activeTab = sidebarTabs.includes(tab) ? tab : (sidebarTabs[0] ?? "chat");

  function panelContent(id: MeetingSidebarTab): ReactNode {
    switch (id) {
      case "copilot":
        return meetingId ? (
          <MeetingRoomCopilotTab
            meetingId={meetingId}
            workspaceId={guestMode ? undefined : workspaceId}
            projectId={guestMode ? undefined : meeting?.project_id}
            canClerk={isClerk}
            lateMinutes={guestMode ? null : lateMinutes}
            onDismissCatchUp={onDismissCatchUp}
            scribeOn={scribeOn}
            scribeState={scribeState}
            unseenItems={liveItemIds}
            onViewChange={onUniViewChange}
          />
        ) : (
          <p className="px-3 pt-2 text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
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
      case "motions":
        return meetingId ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MeetingMotionsList
              meeting={guestMode ? undefined : meeting}
              meetingId={meetingId}
              workspaceId={guestMode ? undefined : workspaceId}
              canVote
              density="room"
            />
          </div>
        ) : null;
      case "recordings":
        return meetingId ? <MeetingRoomRecordingsTab meetingId={meetingId} /> : null;
    }
  }

  return (
    <aside className={cn("flex min-h-0 min-w-0 w-full flex-col bg-surface", className)}>
      {/* The sheet (it brings its close button) has no rule under the tabs: the Phone board runs them into the panel. */}
      <div className={cn("relative z-10 shrink-0 py-2.5 pr-2.5 pl-3", !tabsEnd && "border-b border-border")}>
        <RoomPanelTabs
          tabs={sidebarTabs}
          value={activeTab}
          onChange={onTabChange}
          label={tabLabel}
          ariaLabel={t("meetings.roomPanel")}
          icon={tabIcon}
          badge={tabBadge}
          panelId={panelId}
          fill={tabsEnd !== undefined}
          end={
            onCollapse || tabsEnd ? (
              <>
                {onCollapse ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8.5 rounded-[9px] text-muted-foreground"
                    aria-label={t("meetings.panel.collapse")}
                    onClick={onCollapse}
                  >
                    <PanelRightClose aria-hidden />
                  </Button>
                ) : null}
                {tabsEnd}
              </>
            ) : undefined
          }
        />
      </div>

      <div
        role="tabpanel"
        id={panelId(activeTab)}
        aria-label={tabLabel(activeTab)}
        className={cn(PANEL_CLASS, activeTab !== "copilot" && PANEL_PADDING)}
      >
        <RoomPanelNavigation>{panelContent(activeTab)}</RoomPanelNavigation>
      </div>
    </aside>
  );
}
