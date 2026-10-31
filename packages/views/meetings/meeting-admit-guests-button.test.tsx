import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingAdmitGuestsButton } from "./meeting-admit-guests-button";
import { playJoinRequestChime } from "./join-request-chime";

const leaveShareFullscreen = vi.hoisted(() => vi.fn());
vi.mock("./screen-share", () => ({ leaveShareFullscreen }));
vi.mock("./join-request-chime", () => ({ playJoinRequestChime: vi.fn() }));

beforeAll(() => {
  initI18n();
});

function pendingOnce() {
  requestMock.mockResolvedValue({
    join_requests: [
      {
        id: "jr1",
        meeting_id: "m1",
        status: "PENDING",
        display_name_snapshot: "kim kim",
      },
    ],
  });
}

function pendingTwo() {
  requestMock.mockResolvedValue({
    join_requests: [
      {
        id: "jr1",
        meeting_id: "m1",
        status: "PENDING",
        display_name_snapshot: "kim kim",
      },
      {
        id: "jr2",
        meeting_id: "m1",
        status: "PENDING",
        display_name_snapshot: "lan",
      },
    ],
  });
}

describe("MeetingAdmitGuestsButton", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("shows a chip for a single pending request", async () => {
    pendingOnce();

    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" />));

    expect(await screen.findByRole("button", { name: "1 người đang chờ, xem danh sách" })).toBeInTheDocument();
  });

  it("shortens to the icon and the count in a narrow header, keeping the full meaning in its name", async () => {
    pendingTwo();
    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" />));
    const chip = await screen.findByRole("button", { name: "2 người đang chờ, xem danh sách" });
    const count = screen.getByTestId("meeting-admit-count");
    expect(count).toHaveTextContent("2");
    expect(count.className).toMatch(/@4xl\/stagehead:hidden/);
    const full = within(chip).getByText("2 người đang chờ");
    expect(full.className).toMatch(/\bhidden\b/);
    expect(full.className).toMatch(/@4xl\/stagehead:inline/);
  });

  it("takes a full-screen share out of the way once for each new knock", async () => {
    leaveShareFullscreen.mockClear();
    pendingOnce();
    const view = render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" />));
    await screen.findByRole("button", { name: "1 người đang chờ, xem danh sách" });
    await waitFor(() => expect(leaveShareFullscreen).toHaveBeenCalledOnce());

    // The host goes back to full screen: the same knock does not pull them out again.
    view.rerender(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" />));
    expect(leaveShareFullscreen).toHaveBeenCalledOnce();
  });

  it("chimes once per new knock, and not at all where this browser turned it off", async () => {
    vi.mocked(playJoinRequestChime).mockClear();
    window.localStorage.removeItem("uniwork_meeting_join_chime_muted");
    pendingOnce();
    const first = render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" />));
    await screen.findByRole("button", { name: "1 người đang chờ, xem danh sách" });
    expect(playJoinRequestChime).toHaveBeenCalledOnce();
    first.unmount();

    vi.mocked(playJoinRequestChime).mockClear();
    window.localStorage.setItem("uniwork_meeting_join_chime_muted", "1");
    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" />));
    await screen.findByRole("button", { name: "1 người đang chờ, xem danh sách" });
    expect(playJoinRequestChime).not.toHaveBeenCalled();
    window.localStorage.removeItem("uniwork_meeting_join_chime_muted");
  });

  it("opens the people tab instead of admitting when the chip is pressed", async () => {
    pendingOnce();

    const onOpenPeople = vi.fn();
    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" onOpenPeople={onOpenPeople} />));

    fireEvent.click(await screen.findByRole("button", { name: "1 người đang chờ, xem danh sách" }));

    expect(onOpenPeople).toHaveBeenCalledOnce();
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/approve"),
      expect.any(Object),
    );
  });
});
