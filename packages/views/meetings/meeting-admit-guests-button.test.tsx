import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingAdmitGuestsButton } from "./meeting-admit-guests-button";
import { MeetingWaitingToJoinCard } from "./meeting-waiting-to-join-card";

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

    expect(await screen.findByRole("button", { name: "Cho 1 khách vào" })).toBeInTheDocument();
  });

  it("opens the people tab instead of admitting when the chip is pressed", async () => {
    pendingOnce();

    const onOpenPeople = vi.fn();
    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" onOpenPeople={onOpenPeople} />));

    fireEvent.click(await screen.findByRole("button", { name: "Cho 1 khách vào" }));

    expect(onOpenPeople).toHaveBeenCalledOnce();
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/approve"),
      expect.any(Object),
    );
  });
});

describe("MeetingWaitingToJoinCard", () => {
  beforeEach(() => {
    requestMock.mockReset();
    pendingOnce();
  });

  it("shows admit and deny for a single waiting guest", async () => {
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" />));

    expect(await screen.findByText("Đang chờ vào phòng")).toBeInTheDocument();
    expect(screen.getByText("Chỉ chủ trì mới thấy")).toBeInTheDocument();
    expect(screen.getByText("kim kim")).toBeInTheDocument();
    expect(screen.getByText("Khách chưa xác nhận")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duyệt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeInTheDocument();
    expect(screen.queryByText("1 khách chưa xác nhận")).not.toBeInTheDocument();
  });

  it("approves the pending guest from the card", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.includes("/join-requests") && !path.includes("/approve")) {
        return Promise.resolve({
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
      return Promise.resolve({});
    });

    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" />));

    fireEvent.click(await screen.findByRole("button", { name: "Duyệt" }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("/meeting-join-requests/jr1/approve"),
        expect.any(Object),
      );
    });
  });

  it("offers a link to the full list", async () => {
    const onViewAll = vi.fn();
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" onViewAll={onViewAll} />));

    fireEvent.click(await screen.findByRole("button", { name: "Xem tất cả (1)" }));
    expect(onViewAll).toHaveBeenCalledOnce();
  });

  it("summarizes multiple waiting guests and opens People from the preview", async () => {
    pendingTwo();
    const onViewAll = vi.fn();
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" onViewAll={onViewAll} />));

    expect(await screen.findByText("2 khách chưa xác nhận")).toBeInTheDocument();
    expect(screen.getByText(/kim kim/)).toBeInTheDocument();
    expect(screen.getByText(/lan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duyệt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duyệt tất cả" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /2 khách chưa xác nhận/ }));
    expect(onViewAll).toHaveBeenCalledOnce();
  });
});
