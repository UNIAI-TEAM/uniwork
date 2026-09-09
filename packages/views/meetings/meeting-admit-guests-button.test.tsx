import { fireEvent, render, screen } from "@testing-library/react";
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

  it("summarizes the waiting guest without admit or deny on the card", async () => {
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" />));

    expect(await screen.findByText("Đang chờ vào phòng")).toBeInTheDocument();
    expect(screen.getByText("Chỉ chủ trì mới thấy")).toBeInTheDocument();
    expect(screen.getByText("1 khách chưa xác nhận")).toBeInTheDocument();
    expect(screen.getByText("kim kim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cho kim kim vào|Duyệt|Từ chối|Duyệt tất cả/ })).not.toBeInTheDocument();
  });

  it("offers a link to the full list", async () => {
    const onViewAll = vi.fn();
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" onViewAll={onViewAll} />));

    fireEvent.click(await screen.findByRole("button", { name: "Xem tất cả (1)" }));
    expect(onViewAll).toHaveBeenCalledOnce();
  });

  it("opens the people tab from the unconfirmed preview block", async () => {
    const onViewAll = vi.fn();
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" onViewAll={onViewAll} />));

    fireEvent.click(await screen.findByRole("button", { name: /1 khách chưa xác nhận/ }));
    expect(onViewAll).toHaveBeenCalledOnce();
  });

  it("lists every waiting name in the preview when more than one person is waiting", async () => {
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
    render(wrapWithNav(<MeetingWaitingToJoinCard meetingId="m1" />));

    expect(await screen.findByText("2 khách chưa xác nhận")).toBeInTheDocument();
    expect(screen.getByText(/kim kim/)).toBeInTheDocument();
    expect(screen.getByText(/lan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duyệt tất cả" })).not.toBeInTheDocument();
  });
});
