import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types/meeting";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingSummaryPanel } from "./meeting-summary-panel";

beforeAll(() => {
  initI18n();
});

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  starts_at: "2026-09-22T02:00:00Z",
  ends_at: "2026-09-22T02:30:00Z",
  status: "ENDED",
  host_user_id: "u-host",
} as Meeting;

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
    if (p.endsWith("/summary")) {
      return Promise.resolve({ summary: { id: "s1", meeting_id: "m1", summary: "- Chốt lịch", created_at: "2026-09-22T02:31:00Z" } });
    }
    if (p.endsWith("/transcript")) {
      return Promise.resolve({ segments: [{ id: "t1", meeting_id: "m1", text: "Chốt lịch thứ Sáu", spoken_at: "2026-09-22T02:10:00Z" }] });
    }
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
    return Promise.resolve({});
  });
});

describe("MeetingSummaryPanel", () => {
  it("asks before replacing an existing summary", async () => {
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    fireEvent.click(await screen.findByRole("button", { name: "Tạo lại tóm tắt" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/summary", expect.objectContaining({ method: "POST" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo lại" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/summary", expect.objectContaining({ method: "POST" })),
    );
  });
});

function summaryRespond(summary: () => Promise<unknown>, transcript: () => Promise<unknown> = () => Promise.resolve({ segments: [] })) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
    if (p.endsWith("/summary")) return summary();
    if (p.endsWith("/transcript")) return transcript();
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
    return Promise.resolve({});
  });
}

describe("MeetingSummaryPanel loading", () => {
  it("holds the panel's shape with a skeleton while the summary loads", () => {
    summaryRespond(() => new Promise(() => {}));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(within(panel).getByRole("status")).toHaveTextContent("Đang tải…");
    expect(within(panel).queryByText(/Chưa có transcript/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Chưa có tóm tắt/)).not.toBeInTheDocument();
  });

  it("does not claim there is no transcript while the transcript is still loading", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }), () => new Promise(() => {}));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(within(panel).queryByText(/Chưa có transcript/)).not.toBeInTheDocument();
  });

  it("says there is no transcript yet once both have arrived empty", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText(/Chưa có transcript/)).toBeInTheDocument();
    expect(within(panel).queryByText("Đang tải…")).not.toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when the summary fails", async () => {
    summaryRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText("Không tải được tóm tắt.")).toBeInTheDocument();
    expect(within(panel).queryByText(/Chưa có transcript/)).not.toBeInTheDocument();

    summaryRespond(() => Promise.resolve({ summary: null }));
    fireEvent.click(within(panel).getByRole("button", { name: "Thử lại" }));
    expect(await within(panel).findByText(/Chưa có transcript/)).toBeInTheDocument();
  });
});
