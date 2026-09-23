import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types/meeting";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingSummaryPanel, summarySourceFacts } from "./meeting-summary-panel";

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
    expect(within(panel).queryByText(/Chưa có bản ghi lời thoại/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Chưa có tóm tắt/)).not.toBeInTheDocument();
  });

  it("does not claim there is no transcript while the transcript is still loading", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }), () => new Promise(() => {}));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(within(panel).queryByText(/Chưa có bản ghi lời thoại/)).not.toBeInTheDocument();
  });

  it("says there is no transcript yet once both have arrived empty", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText(/Chưa có bản ghi lời thoại/)).toBeInTheDocument();
    expect(within(panel).queryByText("Đang tải…")).not.toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when the summary fails", async () => {
    summaryRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText("Không tải được tóm tắt.")).toBeInTheDocument();
    expect(within(panel).queryByText(/Chưa có bản ghi lời thoại/)).not.toBeInTheDocument();

    summaryRespond(() => Promise.resolve({ summary: null }));
    fireEvent.click(within(panel).getByRole("button", { name: "Thử lại" }));
    expect(await within(panel).findByText(/Chưa có bản ghi lời thoại/)).toBeInTheDocument();
  });
});

describe("MeetingSummaryPanel attribution", () => {
  it("labels the summary as AI output with its source, time and model", async () => {
    const created = new Date(Date.now() - 2 * 3_600_000).toISOString();
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary")) {
        return Promise.resolve({ summary: { id: "s1", meeting_id: "m1", summary: "Chốt lịch", model: "claude-sonnet", created_at: created } });
      }
      if (p.endsWith("/transcript")) {
        return Promise.resolve({
          segments: [
            { id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T02:10:00Z" },
            { id: "t2", meeting_id: "m1", text: "Hai", spoken_at: "2026-09-22T02:11:00Z" },
          ],
        });
      }
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const line = await screen.findByTestId("ai-attribution");
    expect(within(line).getByText("AI")).toBeInTheDocument();
    // No count: the server keeps no snapshot of what the summary read.
    expect(within(line).getByText("Từ bản ghi lời thoại")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-summary-stale")).not.toBeInTheDocument();
    expect(within(line).getByText("claude-sonnet")).toBeInTheDocument();
    const time = within(line).getByText("2 giờ trước");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", created);
    expect(time.getAttribute("title")).toBeTruthy();
  });

  it("lets the host summarise from notes alone", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary")) return Promise.resolve({ summary: null });
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [{ id: "n1", meeting_id: "m1", author_id: "u1", body: "Chốt lịch" }] });
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    await waitFor(() => expect(screen.getByRole("button", { name: "Tạo tóm tắt" })).toBeEnabled());
  });

  it("says why generating is unavailable when there is neither transcript nor notes", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).toBeDisabled());
    const reason = screen.getByText("Cần bản ghi lời thoại hoặc ghi chú để tạo tóm tắt.");
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("says when transcript or notes arrived after the summary was generated", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary")) {
        return Promise.resolve({ summary: { id: "s1", meeting_id: "m1", summary: "Chốt lịch", created_at: "2026-09-22T02:20:00Z" } });
      }
      if (p.endsWith("/transcript")) {
        return Promise.resolve({ segments: [{ id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T02:10:00Z" }] });
      }
      if (p.endsWith("/notes")) {
        return Promise.resolve({
          notes: [{ id: "n1", meeting_id: "m1", author_id: "u1", body: "Sau", created_at: "2026-09-22T02:25:00Z" }],
        });
      }
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    expect(await screen.findByText("Có dữ liệu mới sau khi tạo tóm tắt")).toBeInTheDocument();
    // The note came later, so the summary was made from the transcript alone.
    expect(within(screen.getByTestId("ai-attribution")).getByText("Từ bản ghi lời thoại")).toBeInTheDocument();
  });

  it("hides the arrow from screen readers and says who the item goes to", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary")) {
        return Promise.resolve({
          summary: {
            id: "s1",
            meeting_id: "m1",
            summary: "Chốt lịch",
            action_items: [{ title: "Gửi biên bản", owner: "Mai Anh" }],
            created_at: "2026-09-22T02:31:00Z",
          },
        });
      }
      if (p.endsWith("/members")) {
        return Promise.resolve({
          members: [{ workspace_id: "w1", user_id: "u-mai", role: "member", email: "mai@x.com", display_name: "Mai Anh" }],
        });
      }
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    expect(await screen.findByText("giao cho")).toHaveClass("sr-only");
    expect(screen.getByText("→")).toHaveAttribute("aria-hidden");
  });
});

describe("summarySourceFacts", () => {
  const seg = (spoken_at: string) => ({ id: spoken_at, meeting_id: "m1", text: "x", spoken_at });
  const note = (created_at: string | null) => ({ id: String(created_at), meeting_id: "m1", author_id: "u", body: "x", created_at });

  it("judges the source by what existed when the summary was made", () => {
    const at = "2026-09-22T02:20:00Z";
    expect(summarySourceFacts(at, [seg("2026-09-22T02:10:00Z")], [note("2026-09-22T02:15:00Z")])).toEqual({ kind: "both", stale: false });
    expect(summarySourceFacts(at, [], [note("2026-09-22T02:15:00Z")])).toEqual({ kind: "notes", stale: false });
    expect(summarySourceFacts(at, [seg("2026-09-22T02:30:00Z")], [])).toEqual({ kind: null, stale: true });
  });

  it("claims nothing without a generation time", () => {
    expect(summarySourceFacts(undefined, [seg("2026-09-22T02:10:00Z")], [])).toEqual({ kind: null, stale: false });
    expect(summarySourceFacts("2026-09-22T02:20:00Z", [], [note(null)])).toEqual({ kind: null, stale: false });
  });
});
