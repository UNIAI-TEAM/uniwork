import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { MeetingRecordHeldButton } from "./meeting-record-held-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const HELD = "/api/v1/meetings/m1/held";
const NOW = Date.parse("2026-10-20T10:00:00Z");

function meeting(startsAt: string, endsAt: string): Meeting {
  return {
    id: "m1", workspace_id: "w1", title: "Họp chi bộ", description: "", starts_at: startsAt, ends_at: endsAt,
    room_name: "r", created_by: "u1", status: "SCHEDULED", timezone: "Asia/Ho_Chi_Minh",
  };
}

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(toast.success).mockReset();
  requestMock.mockReset();
  requestMock.mockResolvedValue({ meeting: { ...meeting("2026-10-20T02:00:00Z", "2026-10-20T03:30:00Z"), status: "ENDED" } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MeetingRecordHeldButton", () => {
  it("records the scheduled times by default", async () => {
    render(wrap(<MeetingRecordHeldButton workspaceId="w1" meeting={meeting("2026-10-20T02:00:00Z", "2026-10-20T03:30:00Z")} />));
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận đã họp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ghi nhận" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(HELD, expect.anything()));
    const body = (requestMock.mock.calls.find((c) => c[0] === HELD)![1] as { body: { started_at: string; ended_at: string } }).body;
    expect(Date.parse(body.started_at)).toBe(Date.parse("2026-10-20T02:00:00Z"));
    expect(Date.parse(body.ended_at)).toBe(Date.parse("2026-10-20T03:30:00Z"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã ghi nhận cuộc họp đã diễn ra."));
  });

  it("writes the day the way the meeting hero does", async () => {
    render(wrap(<MeetingRecordHeldButton workspaceId="w1" meeting={meeting("2026-10-20T02:00:00Z", "2026-10-20T03:30:00Z")} />));
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận đã họp" }));
    expect(await screen.findByText("Thứ Ba, 20 tháng 10")).toBeInTheDocument();
    expect(screen.queryByText(/thg 10, 2026/)).not.toBeInTheDocument();
  });

  it("opens inside the meeting window ending now, without an error", async () => {
    // Scheduled 09:00–12:00 UTC, now 10:00: the end defaults to now, not the schedule.
    render(wrap(<MeetingRecordHeldButton workspaceId="w1" meeting={meeting("2026-10-20T09:00:00Z", "2026-10-20T12:00:00Z")} />));
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận đã họp" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(HELD, expect.anything()));
    const body = (requestMock.mock.calls.find((c) => c[0] === HELD)![1] as { body: { started_at: string; ended_at: string } }).body;
    expect(Date.parse(body.ended_at)).toBe(NOW);
  });

  it("refuses an end that has not happened yet", async () => {
    render(wrap(<MeetingRecordHeldButton workspaceId="w1" meeting={meeting("2026-10-20T09:00:00Z", "2026-10-20T12:00:00Z")} />));
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận đã họp" }));
    // The end starts at now (17:00 in the meeting's zone); one hour later is the future.
    fireEvent.keyDown(await screen.findByLabelText("Giờ kết thúc"), { key: "ArrowUp" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Giờ kết thúc không được ở tương lai.");
    const submit = screen.getByRole("button", { name: "Ghi nhận" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(requestMock).not.toHaveBeenCalledWith(HELD, expect.anything());
  });

  it("keeps a refusal inside the dialog", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrap(<MeetingRecordHeldButton workspaceId="w1" meeting={meeting("2026-10-20T02:00:00Z", "2026-10-20T03:30:00Z")} />));
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận đã họp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ghi nhận" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa ghi nhận được cuộc họp.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
