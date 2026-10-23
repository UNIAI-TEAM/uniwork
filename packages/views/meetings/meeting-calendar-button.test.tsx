import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { wrapWithNav } from "../test/api-mock";
import { MeetingCalendarButton, meetingIcsFileName } from "./meeting-calendar-button";

vi.mock("sonner", async (orig) => {
  const mod = await orig<typeof import("sonner")>();
  return { ...mod, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

vi.mock("@uniwork/core/api/endpoints/meetings", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/meetings")>()),
  fetchMeetingCalendar: vi.fn(() => Promise.resolve("BEGIN:VCALENDAR\nEND:VCALENDAR")),
}));

describe("meetingIcsFileName", () => {
  it("names the file after the meeting title", () => {
    expect(meetingIcsFileName("Họp giao ban Đội Sản phẩm", "m1")).toBe("hop-giao-ban-doi-san-pham.ics");
  });

  it("falls back to the id when the title has nothing usable", () => {
    expect(meetingIcsFileName("  ??? ", "01J8X")).toBe("meeting-01J8X.ics");
  });
});

describe("MeetingCalendarButton", () => {
  it("downloads the .ics under the slugged title and confirms", async () => {
    const anchors: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    }) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();

    render(wrapWithNav(<MeetingCalendarButton meetingId="m1" title="Họp giao ban" />));
    fireEvent.click(screen.getByRole("button", { name: "Thêm vào lịch" }));

    await waitFor(() => expect(anchors.at(-1)?.download).toBe("hop-giao-ban.ics"));
    expect(toast.success).toHaveBeenCalled();
  });
});
