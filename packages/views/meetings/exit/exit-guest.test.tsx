import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { inviteStorageKey } from "../meeting-invite-session";
import type { RoomExit } from "./exit-model";
import { newGuestTally, tallySummary } from "./use-guest-tally";
import { MeetingExitScreen } from "./meeting-exit-screen";

const invite = { linkId: "l1", secret: "sec" };
let meetingState = "open";

const person = (id: string, name: string, inRoom: boolean) => ({
  id, meeting_id: "m1", principal_type: "USER", display_name_snapshot: name, role: "ATTENDEE", status: "ACTIVE", in_room: inRoom,
});

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  meetingState = "open";
  sessionStorage.setItem(inviteStorageKey("l1", "displayName"), "Nguyễn An");
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/meeting-invite-links/resolve"))
      return Promise.resolve({
        link_id: "l1", meeting_id: "m1", title: "Tổng kết dự án Sao Mai", starts_at: "2026-10-27T08:40:00Z",
        access_mode: "AUTO_ADMIT", expired: false, meeting_state: meetingState, started_at: "2026-10-27T08:41:00Z",
      });
    if (path.endsWith("/participants"))
      return Promise.resolve({ participants: [person("g", "Nguyễn An", false), person("lan", "Hoàng Lan", true), person("ha", "Thu Hà", true)] });
    return Promise.resolve({});
  });
});

function renderGuest(exit: RoomExit, tally = newGuestTally()) {
  const handlers = { onRejoin: vi.fn(), onBackToMeeting: vi.fn(), onExitChange: vi.fn() };
  render(
    wrapWithNav(
      <MeetingExitScreen
        exit={exit}
        meetingId="m1"
        meetingTitle="Tổng kết dự án Sao Mai"
        guestMode
        invite={invite}
        guestTally={tally}
        selfParticipantId="g"
        {...handlers}
      />,
    ),
  );
  return handlers;
}

const media = { audio: true, video: true };

describe("guest leave screen G", () => {
  it("keeps the guest's name for the way back in, on the public page with the UniWork lockup", async () => {
    const { onRejoin, onBackToMeeting } = renderGuest({ kind: "left", media });
    expect(screen.getAllByRole("img", { name: "UniWork" }).length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "Bạn đã rời phòng" })).toBeInTheDocument();
    expect(screen.getByText("Nguyễn An")).toBeInTheDocument();
    expect(await screen.findByText("2 người vẫn đang họp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vào lại" }));
    expect(onRejoin).toHaveBeenCalledExactlyOnceWith(media);
    fireEvent.click(screen.getByRole("button", { name: "Đổi tên hoặc thiết bị" }));
    expect(onBackToMeeting).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Dùng cho đội của bạn" })).toHaveAttribute("href", "/register");
  });

  it("turns into the thank-you screen when the meeting ends while the guest is out", async () => {
    meetingState = "ended";
    const { onExitChange } = renderGuest({ kind: "left", media });
    await waitFor(() => expect(onExitChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "ended" })));
  });
});

describe("guest end screen H", () => {
  it("thanks the guest with their time in the room and who was there, and sends no minutes", async () => {
    const tally = newGuestTally();
    tally.connectedMs = 32 * 60_000;
    for (const [id, name] of [["a", "Demo"], ["b", "Lan"], ["c", "Hà"], ["d", "Minh"], ["e", "Quân"], ["f", "An"]]) tally.seen.set(id!, name!);
    renderGuest({ kind: "ended", at: "2026-10-27T09:21:00Z" }, tally);
    expect(await screen.findByRole("heading", { name: "Cảm ơn bạn đã tham gia" })).toBeInTheDocument();
    expect(screen.getByText(/Cuộc họp đã kết thúc lúc \d{2}:21 · Tổng kết dự án Sao Mai/)).toBeInTheDocument();
    expect(screen.getByText("32 phút")).toBeInTheDocument();
    expect(screen.getByText("6 người")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dùng thử UniWork" })).toHaveAttribute("href", "/register");
    expect(screen.queryByText(/Biên bản/)).not.toBeInTheDocument();
  });
});

describe("tallySummary", () => {
  it("adds the running connection to what was banked and counts each person once", () => {
    const tally = newGuestTally();
    tally.connectedMs = 10 * 60_000;
    tally.since = 1_000;
    tally.seen.set("x", "X");
    tally.seen.set("x", "X again");
    expect(tallySummary(tally, 1_000 + 5 * 60_000 + 20_000)).toEqual({ minutes: 15, people: 1, names: ["X again"] });
    expect(tallySummary(newGuestTally(), 0)).toEqual({ minutes: 0, people: 0, names: [] });
  });
});
