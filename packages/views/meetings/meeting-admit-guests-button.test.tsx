import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingAdmitGuestsButton } from "./meeting-admit-guests-button";
import { MeetingWaitingToJoinOverlay } from "./meeting-waiting-to-join-overlay";

beforeAll(() => {
  initI18n();
});

describe("MeetingAdmitGuestsButton", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("shows a one-click admit button for a single pending request", async () => {
    requestMock.mockResolvedValue({
      join_requests: [
        {
          id: "jr1",
          meeting_id: "m1",
          status: "PENDING",
          display_name_snapshot: "Guest One",
        },
      ],
    });

    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" />));

    expect(await screen.findByRole("button", { name: "Cho 1 khách vào" })).toBeInTheDocument();
  });

  it("approves the pending guest when the host clicks admit", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.includes("/join-requests") && !path.includes("/approve")) {
        return Promise.resolve({
          join_requests: [
            {
              id: "jr1",
              meeting_id: "m1",
              status: "PENDING",
              display_name_snapshot: "Guest One",
            },
          ],
        });
      }
      if (path.includes("/approve")) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" />));

    fireEvent.click(await screen.findByRole("button", { name: "Cho 1 khách vào" }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("/meeting-join-requests/jr1/approve"),
        expect.any(Object),
      );
    });
  });

  it("re-opens the overlay when the host clicks the header button", async () => {
    requestMock.mockResolvedValue({
      join_requests: [
        {
          id: "jr1",
          meeting_id: "m1",
          status: "PENDING",
          display_name_snapshot: "Guest One",
        },
      ],
    });

    const onOpenOverlay = vi.fn();
    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" onOpenOverlay={onOpenOverlay} />));

    fireEvent.click(await screen.findByRole("button", { name: "Cho 1 khách vào" }));
    expect(onOpenOverlay).toHaveBeenCalledOnce();
  });
});

describe("MeetingWaitingToJoinOverlay", () => {
  beforeEach(() => {
    requestMock.mockReset();
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
  });

  it("shows the waiting card with admit and deny actions", async () => {
    render(wrapWithNav(<MeetingWaitingToJoinOverlay meetingId="m1" />));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Đang chờ vào phòng")).toBeInTheDocument();
    expect(screen.getByText("kim kim")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duyệt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeInTheDocument();
  });

  it("can be dismissed until a new request arrives", async () => {
    render(wrapWithNav(<MeetingWaitingToJoinOverlay meetingId="m1" />));

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
