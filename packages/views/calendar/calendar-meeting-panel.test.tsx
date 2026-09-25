import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CalendarMeetingPanel } from "./calendar-meeting-panel";

initI18n();

const detailProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../meetings/meeting-detail-view", () => ({
  MeetingDetailView: (props: Record<string, unknown>) => {
    detailProps.current = props;
    return (
      <div data-testid="meeting-detail-view">
        {props.headerActions as React.ReactNode}
      </div>
    );
  },
}));

describe("CalendarMeetingPanel", () => {
  it("keeps contextual actions available and closes with Escape", () => {
    const onClose = vi.fn();
    const onJoin = vi.fn();
    const onOpenFullPage = vi.fn();

    render(
      wrap(
        <CalendarMeetingPanel
          workspaceId="ws1"
          meetingId="meeting-1"
          onClose={onClose}
          onJoin={onJoin}
          onOpenFullPage={onOpenFullPage}
        />,
      ),
    );

    const panel = screen.getByRole("complementary", { name: "Chi tiết cuộc họp" });
    expect(panel).toHaveClass("2xl:w-[40rem]");
    expect(detailProps.current.layout).toBe("panel");
    expect(detailProps.current.meetingId).toBe("meeting-1");
    expect(screen.getByRole("button", { name: "Đóng" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Mở cuộc họp toàn trang" }));
    expect(onOpenFullPage).toHaveBeenCalledWith("meeting-1");

    (detailProps.current.onJoin as () => void)();
    expect(onJoin).toHaveBeenCalledWith("meeting-1");

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
