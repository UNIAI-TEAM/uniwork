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

    rerender(<MeetingStatusBadge status="OVERTIME" />);
    expect(screen.getByText("Quá giờ")).toBeInTheDocument();

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

describe("status tones", () => {
  // Live, overtime and cancelled are states, so they wear signal colours;
  // PRODUCT.md keeps the meetings violet for identity only.
  it("gives every meeting status one signal tone", () => {
    const tones: Record<string, string> = {};
    for (const status of ["SCHEDULED", "IN_PROGRESS", "OVERTIME", "ENDED", "CANCELED"]) {
      const { container, unmount } = render(<MeetingStatusBadge status={status} />);
      tones[status] = container.querySelector("[data-tone]")?.getAttribute("data-tone") ?? "";
      unmount();
    }
    expect(tones).toEqual({
      SCHEDULED: "info",
      IN_PROGRESS: "success",
      OVERTIME: "warning",
      ENDED: "muted",
      CANCELED: "destructive",
    });
  });

  it("marks RSVP and link states with the same signal set", () => {
    const tone = (ui: React.ReactElement) => {
      const { container, unmount } = render(ui);
      const value = container.querySelector("[data-tone]")?.getAttribute("data-tone");
      unmount();
      return value;
    };
    expect(tone(<MeetingRsvpBadge status="ACCEPTED" />)).toBe("success");
    expect(tone(<MeetingRsvpBadge status="TENTATIVE" />)).toBe("warning");
    expect(tone(<MeetingRsvpBadge status="DECLINED" />)).toBe("destructive");
    expect(tone(<MeetingRsvpBadge status="PENDING" />)).toBe("muted");
    expect(tone(<MeetingLinkBadge status="active" />)).toBe("success");
    expect(tone(<MeetingLinkBadge status="limit_reached" />)).toBe("warning");
    expect(tone(<MeetingLinkBadge status="revoked" />)).toBe("destructive");
    expect(tone(<MeetingLinkBadge status="expired" />)).toBe("muted");
  });
});
