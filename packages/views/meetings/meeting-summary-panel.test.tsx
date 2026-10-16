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
    expect(within(panel).queryByText(NO_TRANSCRIPT_ENDED)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Chưa có tóm tắt/)).not.toBeInTheDocument();
  });

  it("does not claim there is no transcript while the transcript is still loading", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }), () => new Promise(() => {}));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(within(panel).queryByText(NO_TRANSCRIPT_ENDED)).not.toBeInTheDocument();
  });

  it("says an ended meeting has no transcript once both have arrived empty, without suggesting captions", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText(NO_TRANSCRIPT_ENDED)).toBeInTheDocument();
    expect(within(panel).queryByText(/Bật phụ đề/)).not.toBeInTheDocument();
    expect(within(panel).queryByText("Đang tải…")).not.toBeInTheDocument();
  });

  it("points a live meeting with no transcript at the captions", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={{ ...meeting, status: "IN_PROGRESS" }} canHost />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText(/Bật phụ đề trong phòng họp/)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when the summary fails", async () => {
    summaryRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Tạo tóm tắt" })).not.toHaveAttribute("aria-disabled"),
    );
  });

  it("says why generating is unavailable, keeping the button in the tab order", async () => {
    summaryRespond(() => Promise.resolve({ summary: null }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

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
            action_items: [{ index: 0, title: "Gửi biên bản", owner: "Mai Anh", suggested_assignee_id: "u-mai" }],
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
    // The suggestion is the server's, shown before anything is created.
    expect(screen.getByText("Mai Anh", { selector: "p.text-brand" })).toBeInTheDocument();
  });
});

describe("MeetingSummaryPanel sources and project", () => {
  const withAction = {
    id: "s1",
    meeting_id: "m1",
    summary: "Chốt lịch",
    action_items: [{ index: 0, title: "Gửi biên bản" }],
    created_at: "2026-09-22T02:31:00Z",
  };
  const project = {
    id: "p1", organization_id: "o1", workspace_id: "w1", title: "Ra mắt Q4", description: "", status: "in_progress",
    priority: "none", revision: 1, task_count: 0, done_count: 0, resource_count: 0,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  };

  function respondWith(opts: { summary: unknown; projectAnswer?: () => Promise<unknown>; chat?: unknown[] }) {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary/tasks") && init?.method === "POST") {
        return Promise.resolve({ task_ids: ["t1"], items: [{ index: 0, task_id: "t1" }] });
      }
      if (p.endsWith("/summary")) return Promise.resolve({ summary: opts.summary });
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
      if (p.includes("/meetings/m1/chat")) return Promise.resolve({ messages: opts.chat ?? [] });
      if (p.includes("/projects/")) return opts.projectAnswer ? opts.projectAnswer() : Promise.resolve({});
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({});
    });
  }

  function postedItems(): Record<string, unknown>[] {
    const call = requestMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/summary/tasks") && (c[1] as { method?: string } | undefined)?.method === "POST",
    );
    return ((call?.[1] as { body?: { items?: Record<string, unknown>[] } } | undefined)?.body?.items) ?? [];
  }

  it("lets the host summarize a meeting whose only record is its chat", async () => {
    // The server summarises meeting chat too (Summarize, HasMeetingSummarySource).
    respondWith({
      summary: null,
      chat: [{ id: "c1", meeting_id: "m1", sender_name: "An", message: "Chốt thứ Sáu", sent_at: "2026-09-22T02:05:00Z" }],
    });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  });

  it("gives tasks from the summary the meeting's project", async () => {
    respondWith({ summary: withAction, projectAnswer: () => Promise.resolve({ project }) });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={{ ...meeting, project_id: "p1" }} canHost />));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Gửi biên bản/ }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => String(c[0]).includes("/projects/p1"))).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getByRole("button", { name: "Tạo 1 việc" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    await waitFor(() => expect(postedItems()).toHaveLength(1));
    expect(postedItems()[0]).toEqual({ index: 0, assignee_id: null, due_date: null, project_id: "p1" });
  });

  it("drops a project that no longer exists, so tasks can still be created", async () => {
    respondWith({ summary: withAction, projectAnswer: () => Promise.reject(new ApiError("not found", "not_found", 404)) });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={{ ...meeting, project_id: "p-gone" }} canHost />));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Gửi biên bản/ }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => String(c[0]).includes("/projects/p-gone"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Tạo 1 việc" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    await waitFor(() => expect(postedItems()).toHaveLength(1));
    // Explicitly none: the server's default would apply the deleted project.
    expect(postedItems()[0]).toMatchObject({ project_id: "" });
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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByText("Đã biểu quyết")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Quyết định" })).toBeInTheDocument();
    expect(within(panel).getByText("Thông qua kế hoạch quý IV")).toBeInTheDocument();
    expect(within(panel).getByText("3 tán thành · 1 không tán thành · 0 không ý kiến")).toBeInTheDocument();
    expect(within(panel).queryByText("Chưa mở")).not.toBeInTheDocument();
  });

  it("lets the host summarize a meeting whose only record is a vote", async () => {
    respond([closedMotion]);
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    expect(screen.queryByText(NEEDS_SOURCE)).not.toBeInTheDocument();
  });

  it("still asks for a source when nothing has been voted", async () => {
    respond([]);
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
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
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));

    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("42 giây")));
  });
});

describe("MeetingSummaryPanel › action items to tasks", () => {
  const items = [
    { index: 0, title: "Gửi biên bản", owner: "Mai Anh", due: "thứ Sáu", suggested_assignee_id: "u-mai", due_date: "2026-09-25" },
    { index: 1, title: "Báo khách", task_id: "t-old" },
  ];
  const base = { id: "s1", meeting_id: "m1", summary: "Chốt lịch", action_items: items, created_at: "2026-09-22T02:31:00Z" };

  function respond(opts: { summary?: () => unknown; post?: () => Promise<unknown> } = {}) {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary/tasks") && init?.method === "POST") {
        return opts.post ? opts.post() : Promise.resolve({ task_ids: ["t1"], items: [{ index: 0, task_id: "t1" }] });
      }
      if (p.endsWith("/summary")) return Promise.resolve({ summary: opts.summary ? opts.summary() : base });
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
      if (p.endsWith("/members")) {
        return Promise.resolve({
          members: [{ workspace_id: "w1", user_id: "u-mai", role: "member", email: "mai@x.com", display_name: "Mai Anh" }],
        });
      }
      return Promise.resolve({});
    });
  }

  function posted(): { summary_id?: string; items?: Record<string, unknown>[] } {
    const call = requestMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/summary/tasks") && (c[1] as { method?: string } | undefined)?.method === "POST",
    );
    return ((call?.[1] as { body?: unknown } | undefined)?.body ?? {}) as { summary_id?: string; items?: Record<string, unknown>[] };
  }

  async function pickAndReview() {
    fireEvent.click(await screen.findByRole("checkbox", { name: "Gửi biên bản" }));
    fireEvent.click(screen.getByRole("button", { name: "Tạo 1 việc" }));
    return screen.findByRole("dialog");
  }

  it("marks an item already turned into a task, links it and keeps it out of the selection", async () => {
    respond();
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));

    const converted = await screen.findByRole("checkbox", { name: "Báo khách" });
    expect(converted).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Đã tạo việc")).toBeInTheDocument();
  });

  it("names the link to a created task starting with the words it shows", async () => {
    respond();
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />
        </WorkspaceProvider>,
      ),
    );
    const link = await screen.findByRole("link", { name: /Báo khách/ });
    expect(link).toHaveTextContent("Đã tạo việc");
    expect(link.getAttribute("aria-label")?.startsWith("Đã tạo việc")).toBe(true);
  });

  it("asks for a pick before reviewing, keeping the button reachable", async () => {
    respond();
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    const cta = await screen.findByRole("button", { name: "Tạo 0 việc" });
    expect(cta).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById(cta.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "Chọn ít nhất một việc chưa tạo",
    );
  });

  it("sends the summary, the item and the server's suggestion the host saw", async () => {
    respond();
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    const dialog = await pickAndReview();
    expect(within(dialog).getByText("AI ghi: Mai Anh")).toBeInTheDocument();
    expect(within(dialog).getByText("AI ghi hạn: thứ Sáu")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    await waitFor(() => expect(posted().items).toHaveLength(1));
    expect(posted()).toEqual({
      summary_id: "s1",
      items: [{ index: 0, assignee_id: "u-mai", due_date: "2026-09-25", project_id: "" }],
    });
  });

  it("keeps the host's explicit 'nobody' instead of the suggestion", async () => {
    const user = userEvent.setup();
    respond();
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    const dialog = await pickAndReview();

    const assignee = within(dialog).getByRole("combobox", { name: "Gán cho" });
    await waitFor(() => expect(assignee).toHaveTextContent("Mai Anh"));
    await user.click(assignee);
    await user.click(await screen.findByRole("option", { name: "Không gán" }));
    await waitFor(() => expect(assignee).toHaveTextContent("Không gán"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    await waitFor(() => expect(posted().items).toHaveLength(1));
    expect(posted().items?.[0]).toMatchObject({ index: 0, assignee_id: null });
  });

  it("confirms with a way to the new task", async () => {
    vi.mocked(toast.success).mockClear();
    respond();
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />
        </WorkspaceProvider>,
      ),
    );
    const dialog = await pickAndReview();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [text, opts] = vi.mocked(toast.success).mock.calls[0]!;
    expect(text).toBe("Đã tạo 1 việc");
    expect((opts as { action?: { label?: string } } | undefined)?.action?.label).toBe("Xem việc");
    expect(screen.getByTestId("summary-live-region")).toHaveTextContent("Đã tạo 1 việc.");
  });

  it("never reports zero tasks for an answer it cannot read", async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
    respond({ post: () => Promise.resolve({ task_ids: "nope" }) });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    const dialog = await pickAndReview();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(String(vi.mocked(toast.warning).mock.calls[0]![0])).not.toMatch(/0 việc/);
  });

  it("says what to do when an item was converted elsewhere meanwhile", async () => {
    vi.mocked(toast.error).mockClear();
    respond({
      post: () =>
        Promise.reject(new ApiError("x", "summary_item_already_converted", 409, undefined, { indexes: [0] })),
    });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />));
    const dialog = await pickAndReview();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Có việc đã được tạo trước đó. Danh sách đã cập nhật, chọn lại các việc còn lại."),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("drops the selection when the summary is replaced", async () => {
    let current: unknown = base;
    respond({ summary: () => current });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canHost />, undefined, client));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Gửi biên bản" }));
    expect(screen.getByRole("button", { name: "Tạo 1 việc" })).toBeInTheDocument();

    current = { ...base, id: "s2" };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["meeting-summary", "m1"] });
    });
    expect(await screen.findByRole("button", { name: "Tạo 0 việc" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Gửi biên bản" })).not.toBeChecked();
  });
});
