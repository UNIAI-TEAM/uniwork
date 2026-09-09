import { fireEvent, render, screen } from "@testing-library/react";
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

  it("reserves stage height while visible and releases it when it hides", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T09:59:30.000Z"));
    const onHeightChange = vi.fn();
    render(
      <MeetingScheduleBanner
        endsAt="2026-09-03T10:00:00.000Z"
        onHeightChange={onHeightChange}
      />,
    );
    expect(onHeightChange.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);

    onHeightChange.mockClear();
    vi.setSystemTime(new Date("2026-09-03T09:00:00.000Z"));
    render(
      <MeetingScheduleBanner
        endsAt="2026-09-03T10:00:00.000Z"
        onHeightChange={onHeightChange}
      />,
    );
    expect(onHeightChange).toHaveBeenCalledWith(0);
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
