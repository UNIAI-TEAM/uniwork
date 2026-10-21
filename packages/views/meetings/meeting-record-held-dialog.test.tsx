import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { MeetingRecordHeldButton } from "./meeting-record-held-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/held", expect.anything()));
    const body = (requestMock.mock.calls[0]![1] as { body: { started_at: string; ended_at: string } }).body;
    expect(Date.parse(body.started_at)).toBe(Date.parse("2026-10-20T02:00:00Z"));
    expect(Date.parse(body.ended_at)).toBe(Date.parse("2026-10-20T03:30:00Z"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã ghi nhận cuộc họp đã diễn ra."));
  });

  it("refuses an end that has not happened yet", async () => {
    // Scheduled to end two hours from now: the default end is in the future.
    render(wrap(<MeetingRecordHeldButton workspaceId="w1" meeting={meeting("2026-10-20T09:00:00Z", "2026-10-20T12:00:00Z")} />));
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận đã họp" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Giờ kết thúc không được ở tương lai.");
    expect(screen.getByRole("button", { name: "Ghi nhận" })).toBeDisabled();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
