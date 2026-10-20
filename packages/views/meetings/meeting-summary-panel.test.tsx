import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types/meeting";
import { QueryClient } from "@tanstack/react-query";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingSummaryPanel } from "./meeting-summary-panel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

// The meeting fixture has ended: it can no longer gain a transcript.
const NO_TRANSCRIPT_ENDED = "Cuộc họp này không có bản ghi lời thoại.";
const NEEDS_SOURCE = "Cần bản ghi lời thoại, ghi chú, tin nhắn hoặc kết quả biểu quyết trong cuộc họp để tạo tóm tắt.";

beforeAll(() => {
  initI18n();
});

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};
const user = { id: "u-host", email: "host@x.com", display_name: "Host" } as User;

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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(within(panel).getByRole("status")).toHaveTextContent("Đang tải…");
    expect(within(panel).queryByText(NO_TRANSCRIPT_ENDED)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Chưa có tóm tắt/)).not.toBeInTheDocument();
  });

  it("does not claim there is no transcript while the transcript is still loading", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }), () => new Promise(() => {}));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(within(panel).queryByText(NO_TRANSCRIPT_ENDED)).not.toBeInTheDocument();
  });

  it("says an ended meeting has no transcript once both have arrived empty, without suggesting captions", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText(NO_TRANSCRIPT_ENDED)).toBeInTheDocument();
    expect(within(panel).queryByText(/Bật phụ đề/)).not.toBeInTheDocument();
    expect(within(panel).queryByText("Đang tải…")).not.toBeInTheDocument();
  });

  it("points a live meeting with no transcript at the captions", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={{ ...meeting, status: "IN_PROGRESS" }} canClerk />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText(/Bật phụ đề trong phòng họp/)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when the summary fails", async () => {
    summaryRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText("Không tải được tóm tắt.")).toBeInTheDocument();
    expect(within(panel).queryByText(NO_TRANSCRIPT_ENDED)).not.toBeInTheDocument();

    summaryRespond(() => Promise.resolve({ summary: null }));
    fireEvent.click(within(panel).getByRole("button", { name: "Thử lại" }));
    expect(await within(panel).findByText(NO_TRANSCRIPT_ENDED)).toBeInTheDocument();
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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Tạo tóm tắt" })).not.toHaveAttribute("aria-disabled"),
    );
  });

  it("says why generating is unavailable, keeping the button in the tab order", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    const reason = await screen.findByText(NEEDS_SOURCE);
    const button = screen.getByRole("button", { name: "Tạo tóm tắt" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    fireEvent.click(button);
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/summary", expect.objectContaining({ method: "POST" }));
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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    expect(await screen.findByText("Có dữ liệu mới sau khi tạo tóm tắt")).toBeInTheDocument();
    // The note came later, so the summary was made from the transcript alone.
    expect(within(screen.getByTestId("ai-attribution")).getByText("Từ bản ghi lời thoại")).toBeInTheDocument();
  });
});

describe("MeetingSummaryPanel sources", () => {
  it("lets a clerk summarize a meeting whose only record is its chat", async () => {
    // The server summarises meeting chat too (Summarize, HasMeetingSummarySource).
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary")) return Promise.resolve({ summary: null });
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
      if (p.includes("/meetings/m1/chat")) {
        return Promise.resolve({
          messages: [{ id: "c1", meeting_id: "m1", sender_name: "An", message: "Chốt thứ Sáu", sent_at: "2026-09-22T02:05:00Z" }],
        });
      }
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  });

  it("offers no generate button to a member who is not a clerk", async () => {
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk={false} />));
    expect(await screen.findByText("- Chốt lịch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tóm tắt/ })).not.toBeInTheDocument();
  });
});

describe("MeetingSummaryPanel › voted decisions", () => {
  const closedMotion = {
    id: "mo1",
    title: "Thông qua kế hoạch quý IV",
    description: "",
    position: 1,
    ballot_mode: "PUBLIC",
    threshold: "MAJORITY",
    base: "PRESENT",
    status: "CLOSED",
    roll_size: 4,
    total_members: 5,
    cast_count: 4,
    result: { yes: 3, no: 1, abstain: 0, required: 3, outcome: "PASSED" },
    voters: { yes: ["An", "Bình", "Chi"], no: ["Dũng"], abstain: [] },
    my_ballot: { on_roll: true, cast: true, choice: "YES" },
  };

  function respond(motions: unknown[]) {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary")) return Promise.resolve({ summary: null });
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/motions")) return Promise.resolve({ motions });
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
      return Promise.resolve({});
    });
  }

  it("shows what was voted even without an AI summary", async () => {
    respond([closedMotion, { ...closedMotion, id: "mo2", title: "Chưa mở", position: 2, status: "DRAFT", result: null, voters: null }]);
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText("Đã biểu quyết")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Quyết định" })).toBeInTheDocument();
    expect(within(panel).getByText("Thông qua kế hoạch quý IV")).toBeInTheDocument();
    expect(within(panel).getByText("3 tán thành · 1 không tán thành · 0 không ý kiến")).toBeInTheDocument();
    expect(within(panel).queryByText("Chưa mở")).not.toBeInTheDocument();
  });

  it("lets the host summarize a meeting whose only record is a vote", async () => {
    respond([closedMotion]);
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    expect(screen.queryByText(NEEDS_SOURCE)).not.toBeInTheDocument();
  });

  it("still asks for a source when nothing has been voted", async () => {
    respond([]);
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    expect(await screen.findByText(NEEDS_SOURCE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tạo tóm tắt" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("Đã biểu quyết")).not.toBeInTheDocument();
  });
});

describe("MeetingSummaryPanel transcript pages", () => {
  it("says more lines exist and loads the earlier transcript on demand", async () => {
    const seg = (id: string, min: number) => ({
      id,
      meeting_id: "m1",
      text: `câu ${id}`,
      spoken_at: `2026-09-22T02:${String(min).padStart(2, "0")}:00Z`,
    });
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary")) return Promise.resolve({ summary: null });
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [seg("t2", 20)], older_cursor: "o2", after_cursor: "x" });
      if (p.endsWith("/transcript?before=o2")) return Promise.resolve({ segments: [seg("t1", 10)] });
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    fireEvent.click(await screen.findByRole("button", { name: /Xem lời thoại \(1\+ câu\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Tải lời thoại trước đó" }));
    const list = await screen.findByTestId("meeting-transcript");
    await waitFor(() => expect(within(list).getByText("câu t1")).toBeInTheDocument());
    expect(within(list).queryByRole("button", { name: "Tải lời thoại trước đó" })).not.toBeInTheDocument();
  });
});

describe("MeetingSummaryPanel › generating", () => {
  function respondGenerate(post: () => Promise<unknown>) {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary") && init?.method === "POST") return post();
      if (p.endsWith("/summary")) return Promise.resolve({ summary: null });
      if (p.endsWith("/transcript")) {
        return Promise.resolve({ segments: [{ id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T02:10:00Z" }] });
      }
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({});
    });
  }

  it("shows a spinner, holds the button still and announces the wait while the model works", async () => {
    respondGenerate(() => new Promise(() => {}));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));

    fireEvent.click(button);
    const busy = await screen.findByRole("button", { name: "Đang tóm tắt…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("summary-live-region")).toHaveTextContent("Đang tạo tóm tắt. Có thể mất tới một phút.");
  });

  it.each([
    ["ai_quota_exceeded", 402, "Tổ chức đã dùng hết hạn mức AI của tháng."],
    ["entitlement_required", 403, "Gói hiện tại chưa có tóm tắt AI."],
    ["summary_in_progress", 409, "Tóm tắt của cuộc họp này đang được tạo."],
    ["ai_timeout", 504, "AI trả lời quá lâu"],
    ["internal", 500, "Chưa tạo được tóm tắt. Thử lại."],
  ])("says what to do for %s, never the server's own message", async (code, status, copy) => {
    vi.mocked(toast.error).mockClear();
    respondGenerate(() => Promise.reject(new ApiError("pgx: raw internal detail", code, status)));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));

    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(copy)));
    expect(String(vi.mocked(toast.error).mock.calls[0]![0])).not.toContain("pgx");
    expect(screen.getByTestId("summary-live-region")).toHaveTextContent(copy);
  });

  it("names the wait a rate limit asks for", async () => {
    vi.mocked(toast.error).mockClear();
    respondGenerate(() =>
      Promise.reject(new ApiError("x", "ai_rate_limited", 429, undefined, { retry_after: 42 })),
    );
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));

    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("42 giây")));
  });
});
