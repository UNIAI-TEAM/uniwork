import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingScheduleBanner } from "./meeting-schedule-banner";

beforeAll(() => {
  initI18n();
});

describe("MeetingScheduleBanner", () => {
  it("shows the countdown in the final minute before scheduled end", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T09:59:30.000Z"));
    render(<MeetingScheduleBanner endsAt="2026-09-03T10:00:00.000Z" />);
    expect(screen.getByTestId("meeting-schedule-banner")).toBeInTheDocument();
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

  it("renders nothing once scheduled time has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T10:00:01.000Z"));
    const { container } = render(<MeetingScheduleBanner endsAt="2026-09-03T10:00:00.000Z" />);
    expect(container).toBeEmptyDOMElement();
    vi.useRealTimers();
  });
});
