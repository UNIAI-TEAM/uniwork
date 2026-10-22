import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomCopilotTab } from "./meeting-room-copilot-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

beforeAll(() => {
  initI18n();
});

const summary = {
  id: "s1",
  meeting_id: "m1",
  summary: "- Chốt lịch phát hành",
  decisions: ["Phát hành thứ Sáu"],
  created_at: "2026-09-22T07:05:00Z",
};

const actionItems = {
  items: [
    { id: "a0", source: "AI", title: "Viết ghi chú phát hành", status: "PENDING" },
    { id: "a1", source: "AI", title: "Báo khách hàng", status: "PENDING" },
  ],
  counts: { pending: 2, converted: 0, dismissed: 0, tasks_done: 0, tasks_overdue: 0 },
};

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/summary")) return Promise.resolve({ summary });
    if (p.endsWith("/action-items")) return Promise.resolve(actionItems);
    if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
    if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
    if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
    return Promise.resolve({});
  });
});

describe("MeetingRoomCopilotTab", () => {
  it("does not dress up the picked checkboxes as task progress", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));

    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    expect(await screen.findByText("Viết ghi chú phát hành")).toBeInTheDocument();
    expect(screen.queryByText("Tiến độ")).not.toBeInTheDocument();
    expect(screen.queryByText(/Hoàn thành \d+ \/ \d+ việc/)).not.toBeInTheDocument();
  });

  it("labels the copy button as an action, not as its result", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));

    fireEvent.click(await screen.findByRole("tab", { name: "Tổng quan" }));
    expect(await screen.findByRole("button", { name: "Sao chép" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đã sao chép" })).not.toBeInTheDocument();
  });
});

describe("MeetingRoomCopilotTab labels and errors", () => {
  it("names the note field and says when a note did not save", async () => {
    vi.mocked(toast.error).mockClear();
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      if (String(path).endsWith("/notes") && init?.method === "POST") {
        return Promise.reject(new ApiError("", "internal", 500));
      }
      return base?.(path, init);
    });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Ghi chú" }));
    const input = await screen.findByRole("textbox", { name: "Ghi chú mới" });
    fireEvent.change(input, { target: { value: "Gửi lịch cho khách" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(input).toHaveValue("Gửi lịch cho khách");
  });
});

describe("MeetingRoomCopilotTab summary errors", () => {
  it("keeps a refused summary run on the panel, with no retry a plan refusal cannot use", async () => {
    vi.mocked(toast.error).mockClear();
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/summary") && init?.method === "POST") return Promise.reject(new ApiError("x", "ai_quota_exceeded", 402));
      if (p.endsWith("/summary")) return Promise.resolve({ summary: null });
      if (p.endsWith("/transcript")) {
        return Promise.resolve({ segments: [{ id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T07:00:00Z" }] });
      }
      return base?.(path, init);
    });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(button);
    const scroll = screen.getByTestId("meeting-copilot-scroll");
    await waitFor(() => expect(scroll).toHaveTextContent("Tổ chức đã dùng hết hạn mức AI của tháng."));
    expect(within(scroll).queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("MeetingRoomCopilotTab honesty", () => {
  it("no longer shows Q&A as a locked coming-soon row: Ask UNI about the meeting has shipped (B8)", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    await screen.findByRole("button", { name: "Sao chép" });
    expect(screen.queryByText("Sắp có")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-copilot-ask-locked")).not.toBeInTheDocument();
  });

  it("labels the summary as AI output with the sources it really had and a dated time", async () => {
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      if (String(path).endsWith("/transcript")) {
        return Promise.resolve({ segments: [{ id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T07:00:00Z" }] });
      }
      return base?.(path, init);
    });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    const attribution = await screen.findByTestId("meeting-summary-attribution");
    expect(attribution).toHaveTextContent("AI");
    await waitFor(() => expect(attribution).toHaveTextContent("Tạo tự động từ bản ghi lời thoại ·"));
    expect(attribution).not.toHaveTextContent(/ghi chú|tin nhắn/);
    // Not today's summary, so it names its day, in the detail page's style.
    expect(attribution).toHaveTextContent(/22 tháng 9/);
  });

  it("leaves the recording state to the stage header badge", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/summary")) return Promise.resolve({ summary });
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/recordings"))
        return Promise.resolve({
          recordings: [{ id: "r1", meeting_id: "m1", status: "ACTIVE", started_at: "2026-09-22T07:00:00Z" }],
        });
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    await screen.findByRole("button", { name: "Sao chép" });
    expect(screen.queryByText("Đang ghi hình trực tiếp")).not.toBeInTheDocument();
  });

  it("is titled UNI, puts the default section first and does not repeat a tab as a heading", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    expect(screen.getByRole("heading", { name: "UNI" })).toBeInTheDocument();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("Tổng quan");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // The AI summary is a summary, not the people's notes.
    expect(await screen.findByRole("heading", { name: "Tóm tắt" })).toBeInTheDocument();
    expect(screen.queryByText("Ghi chú cuộc họp")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Việc cần làm" }));
    await screen.findByText("Viết ghi chú phát hành");
    expect(screen.queryByRole("heading", { name: "Việc cần làm" })).not.toBeInTheDocument();
  });

  it("wires each section tab to its panel", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    const tab = await screen.findByRole("tab", { name: "Tổng quan" });
    const panel = screen.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
  });
});

type Respond = () => Promise<unknown>;
const pending: Respond = () => new Promise(() => {});
const failed: Respond = () => Promise.reject(new ApiError("boom", "internal", 500));

function copilotRespond({
  summary = () => Promise.resolve({ summary: null }),
  transcript = () => Promise.resolve({ segments: [] }),
  notes = () => Promise.resolve({ notes: [] }),
}: { summary?: Respond; transcript?: Respond; notes?: Respond }) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/summary")) return summary();
    if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
    if (p.endsWith("/transcript")) return transcript();
    if (p.endsWith("/notes")) return notes();
    if (p.endsWith("/chat")) return Promise.resolve({ messages: [] });
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
    return Promise.resolve({});
  });
}

function renderCopilot() {
  render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
}

describe("MeetingRoomCopilotTab loading", () => {
  it("shows a skeleton for the overview while the summary loads", () => {
    copilotRespond({ summary: pending });
    renderCopilot();

    expect(within(screen.getByRole("tabpanel")).getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(/Chưa có bản ghi lời thoại/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Chưa có tóm tắt/)).not.toBeInTheDocument();
  });

  it("says there is no transcript once everything arrived empty", async () => {
    copilotRespond({});
    renderCopilot();

    expect(await screen.findByText(/Chưa có bản ghi lời thoại/)).toBeInTheDocument();
  });

  it("offers a retry on the overview when the summary fails", async () => {
    copilotRespond({ summary: failed });
    renderCopilot();

    expect(await screen.findByText("Không tải được tóm tắt.")).toBeInTheDocument();
    copilotRespond({});
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(/Chưa có bản ghi lời thoại/)).toBeInTheDocument();
  });

  it("shows a skeleton, then the empty copy, then a retry for notes", async () => {
    copilotRespond({ notes: pending });
    renderCopilot();
    fireEvent.click(screen.getByRole("tab", { name: "Ghi chú" }));
    expect(within(screen.getByRole("tabpanel")).getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(/Chưa có ghi chú/)).not.toBeInTheDocument();
  });

  it("offers a retry for notes when they fail", async () => {
    copilotRespond({ notes: failed });
    renderCopilot();
    fireEvent.click(screen.getByRole("tab", { name: "Ghi chú" }));
    expect(await screen.findByText("Không tải được ghi chú.")).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có ghi chú/)).not.toBeInTheDocument();
  });

  it("shows a skeleton, not the empty copy, while the transcript loads", () => {
    copilotRespond({ transcript: pending });
    renderCopilot();
    fireEvent.click(screen.getByRole("tab", { name: "Lời thoại" }));
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((s) => within(s).queryByText("Đang tải…"))).toBe(true);
    expect(screen.queryByText(/Chưa có bản ghi lời thoại/)).not.toBeInTheDocument();
  });

  it("offers a retry for the transcript when it fails", async () => {
    copilotRespond({ transcript: failed });
    renderCopilot();
    fireEvent.click(screen.getByRole("tab", { name: "Lời thoại" }));
    expect(await screen.findByText("Không tải được bản ghi lời thoại.")).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có bản ghi lời thoại/)).not.toBeInTheDocument();
  });
});

describe("MeetingRoomCopilotTab › summary and tasks, as on the detail page", () => {
  const project = {
    id: "p1", organization_id: "o1", workspace_id: "w1", title: "Ra mắt Q4", description: "", status: "in_progress",
    priority: "none", revision: 1, task_count: 0, done_count: 0, resource_count: 0,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  };

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
    closed_at: "2026-09-22T07:00:00Z",
    result: { yes: 3, no: 1, abstain: 0, required: 3, outcome: "PASSED" },
  };

  const carriedOver = {
    items: [
      {
        action_item_id: "c1",
        meeting: { id: "m0", title: "Giao ban tuần trước", started_at: "2026-10-13T02:00:00Z" },
        task: { id: "t7", title: "Gửi báo giá", status: "todo", done: false, overdue: false, assignee_id: null, due_date: null },
      },
    ],
  };

  function respond(opts: { summary?: unknown; motions?: unknown[] } = {}) {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/action-items/convert") && init?.method === "POST") {
        return Promise.resolve({ links: [{ action_item_id: "a0", task_id: "t1" }] });
      }
      if (p.endsWith("/action-items")) return Promise.resolve(actionItems);
      if (p.endsWith("/carried-over-items")) return Promise.resolve(carriedOver);
      if (p.endsWith("/summary") && init?.method === "POST") return new Promise(() => {});
      if (p.endsWith("/summary")) return Promise.resolve({ summary: opts.summary === undefined ? summary : opts.summary });
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/motions")) return Promise.resolve({ motions: opts.motions ?? [] });
      if (p.includes("/projects/p1")) return Promise.resolve({ project });
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
      return Promise.resolve({});
    });
  }

  function posted(): { items?: Record<string, unknown>[] } {
    const call = requestMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/action-items/convert") && (c[1] as { method?: string } | undefined)?.method === "POST",
    );
    return ((call?.[1] as { body?: unknown } | undefined)?.body ?? {}) as { items?: Record<string, unknown>[] };
  }

  it("asks before replacing the summary", async () => {
    respond({ motions: [closedMotion] });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    const button = await screen.findByRole("button", { name: "Tạo lại tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));

    fireEvent.click(button);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/summary", expect.objectContaining({ method: "POST" }));
  });

  it("counts a closed vote as something to summarise, like the server", async () => {
    respond({ summary: null, motions: [closedMotion] });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  });

  it("gives the new tasks the meeting's project and keeps the call to action for the returning focus", async () => {
    respond();
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" projectId="p1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Viết ghi chú phát hành" }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => String(c[0]).includes("/projects/p1"))).toBe(true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(screen.getByRole("button", { name: "Giao 1 việc" }));

    await waitFor(() => expect(posted().items).toHaveLength(1));
    expect(posted()).toMatchObject({
      items: [{ action_item_id: "a0", assignee_id: null, due_date: null, project_id: "p1" }],
      locale: "vi",
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Giao việc" })).toHaveAttribute("aria-disabled", "true"));
  });

  it("folds the tasks earlier meetings of the project left open into one group", async () => {
    respond();
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" projectId="p1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    const toggle = await screen.findByRole("button", { name: "Việc còn tồn (1)" });
    expect(screen.queryByText("Gửi báo giá")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByText("Gửi báo giá")).toBeInTheDocument();
  });

  it("asks for no carried-over tasks when the meeting has no project", async () => {
    respond();
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    expect(await screen.findByText("Viết ghi chú phát hành")).toBeInTheDocument();
    expect(requestMock.mock.calls.some((c) => String(c[0]).endsWith("/carried-over-items"))).toBe(false);
  });

  it("keeps the host's ticks while they look at another section", async () => {
    respond();
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Báo khách hàng" }));
    expect(screen.getByRole("button", { name: "Giao 1 việc" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Lời thoại" }));
    expect(screen.queryByRole("checkbox", { name: "Báo khách hàng" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Việc cần làm" }));
    expect(await screen.findByRole("checkbox", { name: "Báo khách hàng" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Giao 1 việc" })).toBeInTheDocument();
  });

  it("says why it cannot generate yet, keeping the button reachable", async () => {
    respond({ summary: null });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).toHaveAttribute("aria-describedby"));
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "Cần bản ghi lời thoại, ghi chú, tin nhắn hoặc kết quả biểu quyết",
    );
  });

  it("shows no items and no assign flow without a workspace (items are for members only)", async () => {
    respond();
    render(wrapWithNav(<MeetingRoomCopilotTab meetingId="m1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    expect(await screen.findByText("Chưa có việc cần làm.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(requestMock.mock.calls.some((c) => String(c[0]).endsWith("/action-items"))).toBe(false);
  });

  it("shows a member who is not a clerk the items read-only", async () => {
    respond();
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk={false} />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    expect(await screen.findByText("Viết ghi chú phát hành")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Giao/ })).not.toBeInTheDocument();
  });
});

describe("MeetingRoomCopilotTab transcript and notes", () => {
  const seg = (id: string, min: number) => ({
    id,
    meeting_id: "m1",
    text: `câu ${id}`,
    spoken_at: `2026-09-22T02:${String(min).padStart(2, "0")}:00Z`,
    speaker_name: "Lan",
  });

  it("reads the earlier transcript on request, not only the newest page", async () => {
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: unknown, init?: unknown) => {
      const p = String(path);
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [seg("t2", 20)], older_cursor: "o2", after_cursor: "x" });
      if (p.endsWith("/transcript?before=o2")) return Promise.resolve({ segments: [seg("t1", 10)] });
      return base?.(path, init);
    });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Lời thoại" }));
    const list = await screen.findByTestId("meeting-room-transcript");
    expect(within(list).getByText("câu t2")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Tải lời thoại trước đó" }));
    await waitFor(() => expect(within(list).getByText("câu t1")).toBeInTheDocument());
    expect(within(list).queryByRole("button", { name: "Tải lời thoại trước đó" })).not.toBeInTheDocument();
  });

  it("does not ask for captions while the AI scribe is already transcribing", async () => {
    const { unmount } = render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk scribeOn />));
    fireEvent.click(await screen.findByRole("tab", { name: "Lời thoại" }));
    expect(await screen.findByText(/Thư ký AI đang nghe/)).toBeInTheDocument();
    expect(screen.queryByText(/Bật phụ đề/)).not.toBeInTheDocument();
    unmount();
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Lời thoại" }));
    expect(await screen.findByText(/Bật phụ đề/)).toBeInTheDocument();
  });

  it("names a note's author in words, never by a raw id", async () => {
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: unknown, init?: unknown) => {
      if (String(path).endsWith("/notes")) {
        return Promise.resolve({ notes: [{ id: "n1", meeting_id: "m1", author_id: "01JA0000000000000000000000", body: "Gửi lịch" }] });
      }
      return base?.(path, init);
    });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    fireEvent.click(await screen.findByRole("tab", { name: "Ghi chú" }));
    expect(await screen.findByText("Không rõ người ghi")).toBeInTheDocument();
    expect(screen.queryByText("01JA0000000000000000000000")).not.toBeInTheDocument();
  });

  it("names its section tabs as a list of their own", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk />));
    expect(await screen.findByRole("tablist", { name: "Các mục của UNI" })).toBeInTheDocument();
  });
});
