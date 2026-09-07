import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingLinkBadge, MeetingRsvpBadge, MeetingStatusBadge } from "./meeting-status-badge";

beforeAll(() => {
  initI18n();
});

describe("MeetingStatusBadge", () => {
  it("renders known meeting statuses and falls back to scheduled", () => {
    const { rerender } = render(<MeetingStatusBadge status="SCHEDULED" />);
    expect(screen.getByText("Đã lên lịch")).toBeInTheDocument();

    rerender(<MeetingStatusBadge status="IN_PROGRESS" />);
    expect(screen.getByText("Đang diễn ra")).toBeInTheDocument();

    rerender(<MeetingStatusBadge status="ENDED" />);
    expect(screen.getByText("Đã kết thúc")).toBeInTheDocument();

    rerender(<MeetingStatusBadge status="CANCELED" />);
    expect(screen.getByText("Đã huỷ")).toBeInTheDocument();

    rerender(<MeetingStatusBadge status="UNKNOWN" />);
    expect(screen.getByText("Đã lên lịch")).toBeInTheDocument();
  });
});

describe("MeetingRsvpBadge", () => {
  it("renders RSVP statuses and falls back to pending", () => {
    const { rerender } = render(<MeetingRsvpBadge status="PENDING" />);
    expect(screen.getByText("Chưa phản hồi")).toBeInTheDocument();

    rerender(<MeetingRsvpBadge status="ACCEPTED" />);
    expect(screen.getByText("Nhận lời")).toBeInTheDocument();

    rerender(<MeetingRsvpBadge status="DECLINED" />);
    expect(screen.getByText("Từ chối")).toBeInTheDocument();

    rerender(<MeetingRsvpBadge status="TENTATIVE" />);
    expect(screen.getByText("Chưa chắc")).toBeInTheDocument();

    rerender(<MeetingRsvpBadge status="UNKNOWN" />);
    expect(screen.getByText("Chưa phản hồi")).toBeInTheDocument();
  });
});

describe("MeetingLinkBadge", () => {
  it("renders invite link statuses", () => {
    const { rerender } = render(<MeetingLinkBadge status="active" />);
    expect(screen.getByText("Đang hoạt động")).toBeInTheDocument();

    rerender(<MeetingLinkBadge status="expired" />);
    expect(screen.getByText("Đã hết hạn")).toBeInTheDocument();

    rerender(<MeetingLinkBadge status="revoked" />);
    expect(screen.getByText("Đã thu hồi")).toBeInTheDocument();

    rerender(<MeetingLinkBadge status="limit_reached" />);
    expect(screen.getByText("Đã đạt giới hạn")).toBeInTheDocument();
  });
});
