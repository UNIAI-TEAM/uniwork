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

    expect(await screen.findByRole("button", { name: "1 người đang chờ" })).toBeInTheDocument();
  });

  it("opens the people tab instead of admitting when the chip is pressed", async () => {
    pendingOnce();

    const onOpenPeople = vi.fn();
    render(wrapWithNav(<MeetingAdmitGuestsButton meetingId="m1" onOpenPeople={onOpenPeople} />));

    fireEvent.click(await screen.findByRole("button", { name: "1 người đang chờ" }));

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

  it("shows admit and decline for a single waiting guest", async () => {
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" />));

    expect(await screen.findByText("Đang chờ vào phòng")).toBeInTheDocument();
    expect(screen.getByText("Chỉ chủ trì mới thấy")).toBeInTheDocument();
    expect(screen.getByText("kim kim")).toBeInTheDocument();
    expect(screen.getByText("Khách chưa xác nhận")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cho kim kim vào" })).toHaveTextContent("Cho vào");
    expect(screen.getByRole("button", { name: "Từ chối kim kim" })).toHaveTextContent("Từ chối");
  });

  it("calls a signed-in member a member, not a guest", async () => {
    requestMock.mockResolvedValue({
      join_requests: [
        { id: "jr1", meeting_id: "m1", status: "PENDING", display_name_snapshot: "Minh Khuê", requester_user_id: "u1" },
      ],
    });
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" />));

    expect(await screen.findByText("Thành viên workspace")).toBeInTheDocument();
    expect(screen.queryByText("Khách chưa xác nhận")).not.toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: "Cho kim kim vào" }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("/meeting-join-requests/jr1/approve"),
        expect.any(Object),
      );
    });
  });

  it("declines the pending guest from the card", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.includes("/join-requests") && !path.includes("/reject")) {
        return Promise.resolve({
          join_requests: [{ id: "jr1", meeting_id: "m1", status: "PENDING", display_name_snapshot: "kim kim" }],
        });
      }
      return Promise.resolve({});
    });

    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" />));

    fireEvent.click(await screen.findByRole("button", { name: "Từ chối kim kim" }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("/meeting-join-requests/jr1/reject"),
        expect.any(Object),
      );
    });
  });

  it("does not offer the full list for a single person", async () => {
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" onViewAll={() => {}} />));
    await screen.findByRole("button", { name: "Cho kim kim vào" });
    expect(screen.queryByRole("button", { name: /Xem tất cả/ })).not.toBeInTheDocument();
  });

  it("summarizes several waiting people and offers to admit them all", async () => {
    pendingTwo();
    const onViewAll = vi.fn();
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" onViewAll={onViewAll} />));

    expect(await screen.findByText("2 người đang chờ")).toBeInTheDocument();
    expect(screen.getByText(/kim kim/)).toBeInTheDocument();
    expect(screen.getByText(/lan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cho vào" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cho tất cả vào" })).toBeInTheDocument();

    // The preview is display only; "view all" is the one way to the list.
    expect(screen.queryByRole("button", { name: /2 người đang chờ/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem tất cả (2)" }));
    expect(onViewAll).toHaveBeenCalledOnce();
  });
});
