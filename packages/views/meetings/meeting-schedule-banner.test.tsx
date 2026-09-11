import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingScheduleBanner } from "./meeting-schedule-banner";

const extendMutate = vi.fn();

vi.mock("@uniwork/core/meetings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/meetings")>();
  return {
    ...actual,
    useExtendMeeting: () => ({ mutate: extendMutate, isPending: false }),
  };
});

beforeAll(() => {
  initI18n();
});

describe("MeetingScheduleBanner", () => {
  it("shows the countdown in the final minute before scheduled end", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T09:59:30.000Z"));
    render(<MeetingScheduleBanner endsAt="2026-09-03T10:00:00.000Z" />);
    expect(screen.getByTestId("meeting-schedule-banner")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Còn một phút theo lịch. Phòng không tự đóng.");
    expect(screen.getByRole("status").textContent).not.toMatch(/\d{2}:\d{2}/);
    vi.useRealTimers();
  });

  it("renders nothing when the meeting is far from ending", () => {
    const { container: empty } = render(<MeetingScheduleBanner />);
    expect(empty).toBeEmptyDOMElement();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T09:00:00.000Z"));
    const { container: far } = render(<MeetingScheduleBanner endsAt="2026-09-03T10:00:00.000Z" />);
    expect(far).toBeEmptyDOMElement();
    vi.useRealTimers();
  });

  it("sits in document flow so tiles shrink instead of being overlapped", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T09:59:30.000Z"));
    const { rerender } = render(
      <MeetingScheduleBanner endsAt="2026-09-03T10:00:00.000Z" />,
    );
    const banner = screen.getByTestId("meeting-schedule-banner");
    expect(banner.className).not.toMatch(/\babsolute\b/);
    expect(screen.getByTestId("meeting-schedule-banner-slot")).toHaveAttribute(
      "data-expanded",
      "true",
    );

    rerender(<MeetingScheduleBanner endsAt="2026-09-03T10:15:00.000Z" />);
    expect(screen.getByTestId("meeting-schedule-banner-slot")).not.toHaveAttribute(
      "data-expanded",
    );
    act(() => {
      vi.advanceTimersByTime(280);
    });
    expect(screen.queryByTestId("meeting-schedule-banner-slot")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("stays visible in overtime and lets the host extend the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T10:00:01.000Z"));
    extendMutate.mockClear();
    render(
      <MeetingScheduleBanner
        endsAt="2026-09-03T10:00:00.000Z"
        canHost
        meetingId="m1"
        workspaceId="w1"
      />,
    );
    expect(screen.getByTestId("meeting-schedule-banner")).toHaveTextContent("Đang họp ngoài giờ");
    fireEvent.click(screen.getByRole("button", { name: "Thêm 15 phút" }));
    expect(extendMutate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
