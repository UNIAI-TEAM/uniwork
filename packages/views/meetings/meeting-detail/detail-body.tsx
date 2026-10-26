"use client";
import { cn } from "@uniwork/ui/lib/utils";
import { CanceledBody } from "./canceled-body";
import { ActionItemsBoard } from "./close-out/action-items-board";
import { DetailContext, useDetail } from "./detail-context";
import { DetailTabs, detailPanelId } from "./detail-tabs";
import { DETAIL_GRID } from "./layout";
import { LiveNotesTab } from "./live/live-notes-tab";
import { NotesFeed } from "./live/notes-feed";
import { MinutesTab } from "./minutes/minutes-tab";
import { MissedBody } from "./missed-body";
import { OverviewTab } from "./overview/overview-tab";
import { DetailRail } from "./rail/detail-rail";
import { ScheduledBody } from "./scheduled/scheduled-body";
import { TranscriptTab } from "./transcript/transcript-tab";

/** The main column by state: the current tab's slot, or the one body a tabless state has. */
function MainContent() {
  const { displayStatus, viewer, sections, tabs } = useDetail();
  switch (tabs.current) {
    case "overview":
      return <OverviewTab />;
    case "transcript":
      return <TranscriptTab />;
    case "minutes":
      return <MinutesTab />;
    case "notes":
      return <LiveNotesTab />;
    default:
      break;
  }
  if (displayStatus === "CANCELED") return <CanceledBody />;
  if (displayStatus === "MISSED") return <MissedBody />;
  if (displayStatus === "SCHEDULED") return <ScheduledBody />;
  // An outsider after the start: only what was handed out (AfterOutsider).
  if (viewer === "outsider" && sections.actionItems) {
    return (
      <>
        <ActionItemsBoard />
        <OutsiderNotes />
      </>
    );
  }
  return null;
}

/**
 * The outsider reads the notes too (AfterOutsider "Ghi chú", read-only, no composer): the
 * server answers them to any workspace member.
 * shortcut: NotesFeed still draws nothing for an outsider, so its read-only overview feed is
 * provided a member's view here; drop the override once NotesFeed lets outsiders read.
 */
function OutsiderNotes() {
  const detail = useDetail();
  return (
    <DetailContext.Provider value={{ ...detail, viewer: "member" }}>
      <NotesFeed variant="overview" />
    </DetailContext.Provider>
  );
}

/**
 * Main (680 at 1440, wider on a wider window) and rail 288 (kit `.grid`), 16 under the strip. The rail stacks
 * above main below 928 of content and always in the calendar's docked panel.
 * Without tabs the first section sits 20 under the strip, level with the rail.
 */
export function DetailBody() {
  const { layout, tabs, displayStatus } = useDetail();
  const tabbed = tabs.current !== null;
  return (
    <div
      data-testid="meeting-detail-sections"
      className={cn(
        "mt-4 [[data-panel=roll]_&]:mt-3",
        // PhoneAfter: the tabs sit 4 under the open-bottomed strip.
        displayStatus === "ENDED" && "@max-[37.5rem]/meeting:mt-1",
        // PhoneLive: the tabs sit 20 under the strip (kit `.tabs` margin).
        (displayStatus === "IN_PROGRESS" || displayStatus === "OVERTIME") && "@max-[37.5rem]/meeting:mt-5",
        layout === "panel" ? "grid grid-cols-1" : cn(DETAIL_GRID, "[[data-panel=roll]_&]:grid-cols-1"))}
    >
      <div className="min-w-0">
        <DetailTabs />
        <div
          id={tabbed && tabs.current ? detailPanelId(tabs.current) : undefined}
          role={tabbed ? "tabpanel" : undefined}
          className={cn("min-w-0", !tabbed && "[&>section:first-child]:mt-1")}
        >
          <MainContent />
        </div>
      </div>
      <DetailRail />
    </div>
  );
}
