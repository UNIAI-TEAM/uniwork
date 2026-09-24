import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingMediaError } from "./meeting-media-error";

beforeAll(() => {
  initI18n();
});

describe("MeetingMediaError", () => {
  it("lets a replaced session take the room back from this tab", () => {
    const onRetry = vi.fn();
    const onLeave = vi.fn();
    render(<MeetingMediaError kind="replaced" onRetry={onRetry} onLeave={onLeave} />);

    expect(screen.getByText("Bạn đã vào cuộc họp này ở tab hoặc trình duyệt khác")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dùng ở tab này" }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Rời phòng" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("offers a retry after a failed connection", () => {
    const onRetry = vi.fn();
    render(<MeetingMediaError kind="connection" onRetry={onRetry} onLeave={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
