import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingSheet } from "../meeting-sheet";
import { DetailContext, useDetail, type DetailContextValue } from "./detail-context";
import { ActionItemsBoard } from "./close-out/action-items-board";
import { LiveNotesTab } from "./live/live-notes-tab";
import { NotesFeed } from "./live/notes-feed";
import { RollDrawer } from "./live/roll-drawer";
import { StripLiveRows } from "./live/strip-live-rows";
import { MinutesTab } from "./minutes/minutes-tab";
import { EvidenceTimeChip } from "./overview/evidence-chip";
import { OverviewTab } from "./overview/overview-tab";
import { TranscriptTab } from "./transcript/transcript-tab";
import {
  DEMO_NOW,
  demo,
  demoUser,
  demoWorkspace,
  detailValue,
  routeMeeting,
  type DemoUserKey,
  type MeetingFixtureKey,
} from "./test-fixtures";

// These cases prove the slots, the context and the fixtures fit together; the
// scheduled body and RSVP row are covered by scheduled/scheduled.test.tsx.

function renderSlot(key: MeetingFixtureKey, ui: ReactElement, viewer?: DemoUserKey, value?: Partial<DetailContextValue>) {
  const who = viewer ?? (key === "m1Outsider" ? "tuan" : "lan");
  routeMeeting(key, { viewer: who });
  setSessionUser(demoUser(who));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
        <DetailContext.Provider value={detailValue(key, { user: who, ...value })}>{ui}</DetailContext.Provider>
      </WorkspaceProvider>,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("detail fixtures", () => {
  it("builds the page's context from the demo data", () => {
    expect(detailValue("m1")).toMatchObject({ viewer: "host", displayStatus: "ENDED", aiReadable: true });
    expect(detailValue("m1").tabs.list).toEqual(["overview", "transcript", "minutes"]);
    expect(detailValue("m1", { user: "ha" }).viewer).toBe("secretary");
    expect(detailValue("m1", { user: "minh" }).viewer).toBe("member");
    expect(detailValue("m1", { user: "bao" }).viewer).toBe("admin");
    expect(detailValue("m1Outsider")).toMatchObject({ viewer: "outsider", aiReadable: false, tabs: { list: [] } });
    expect(detailValue("m3").displayStatus).toBe("SCHEDULED");
    expect(detailValue("m4").displayStatus).toBe("IN_PROGRESS");
    expect(detailValue("m4", { now: DEMO_NOW + 3_600_000 }).displayStatus).toBe("OVERTIME");
    expect(detailValue("m5").displayStatus).toBe("CANCELED");
    expect(detailValue("m6").displayStatus).toBe("MISSED");
  });

  it("answers the outsider's summary with the server's 403", async () => {
    routeMeeting("m1Outsider");
    const id = demo.meetings.m1.meeting.id;
    await expect(requestMock(`/api/v1/meetings/${id}/summary`)).rejects.toMatchObject({ status: 403, code: "meeting_ai_restricted" });
    await expect(requestMock(`/api/v1/meetings/${id}`)).resolves.toMatchObject({ meeting: { ai_content_readable: false } });
  });

  it("refuses a slot outside the provider", () => {
    function Probe() {
      useDetail();
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/DetailContext/);
  });
});

describe("slot stubs", () => {
  it("renders the ended overview: summary and action items", async () => {
    renderSlot("m1", <OverviewTab />);
    expect(await screen.findByTestId("meeting-summary-panel")).toBeInTheDocument();
    const pending = demo.meetings.m1.action_items.items.find((i) => i.status === "PENDING")!;
    expect(await screen.findByText(pending.title)).toBeInTheDocument();
  });

  it("renders the action items alone for an outsider, the summary held back", async () => {
    renderSlot("m1Outsider", <OverviewTab />);
    expect(await screen.findByText(demo.m1_as_outsider.action_items.items[0]!.title)).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-summary-panel")).toBeNull();
  });

  it("renders the board, transcript and minutes slots", async () => {
    renderSlot(
      "m1",
      <>
        <ActionItemsBoard />
        <TranscriptTab />
        <MinutesTab />
      </>,
    );
    expect(await screen.findByTestId("meeting-transcript-panel")).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("meeting-minutes-heading")).not.toBeNull());
  });

  it("renders the notes in every variant and in the live tab", async () => {
    renderSlot(
      "m4",
      <>
        <NotesFeed variant="overview" />
        <LiveNotesTab />
        <StripLiveRows />
      </>,
    );
    expect(await screen.findAllByText(demo.meetings.m4.notes[0]!.body)).toHaveLength(2);
  });

  it("opens the roll in a 480 drawer", async () => {
    const onOpenChange = vi.fn();
    renderSlot("m4", <RollDrawer open onOpenChange={onOpenChange} />);
    expect(await screen.findByRole("dialog", { name: "Điểm danh" })).toHaveClass("data-[side=right]:w-120");
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("draws the evidence chip without its popover", () => {
    renderSlot("m1", <EvidenceTimeChip meetingId="m1" refs={[]} time="09:06" />);
    expect(screen.getByRole("button", { name: "Xem căn cứ lúc 09:06" })).toHaveTextContent("09:06");
  });

  it("opens today's dialogs behind the sheet's final props", async () => {
    const meeting = detailValue("m3").meeting;
    renderSlot(
      "m3",
      <>
        <MeetingSheet mode="create" workspaceId={demoWorkspace.id} trigger={<button type="button">Tạo</button>} />
        <MeetingSheet mode="edit" workspaceId={demoWorkspace.id} meeting={meeting} trigger={<button type="button">Sửa</button>} />
        <MeetingSheet
          mode="followUp"
          workspaceId={demoWorkspace.id}
          previous={detailValue("m1").meeting}
          previousParticipants={detailValue("m1").participants}
          trigger={<button type="button">Tiếp</button>}
        />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
