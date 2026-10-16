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
  action_items: [
    { index: 0, title: "Viết ghi chú phát hành" },
    { index: 1, title: "Báo khách hàng" },
  ],
  created_at: "2026-09-22T07:05:00Z",
};

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/summary")) return Promise.resolve({ summary });
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
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));

    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    expect(await screen.findByText("Viết ghi chú phát hành")).toBeInTheDocument();
    expect(screen.queryByText("Tiến độ")).not.toBeInTheDocument();
    expect(screen.queryByText(/Hoàn thành \d+ \/ \d+ việc/)).not.toBeInTheDocument();
  });

  it("labels the copy button as an action, not as its result", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));

    fireEvent.click(await screen.findByRole("tab", { name: "Tổng quan" }));
    expect(await screen.findByRole("button", { name: "Sao chép" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đã sao chép" })).not.toBeInTheDocument();
  });
});

describe("MeetingRoomCopilotTab labels and errors", () => {
  it("labels the AI action items as AI output too", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    await screen.findByText("Viết ghi chú phát hành");
    expect(screen.getByTestId("meeting-summary-attribution")).toHaveTextContent("AI");
  });

  it("names the note field and says when a note did not save", async () => {
    vi.mocked(toast.error).mockClear();
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      if (String(path).endsWith("/notes") && init?.method === "POST") {
        return Promise.reject(new ApiError("", "internal", 500));
      }
      return base?.(path, init);
    });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    fireEvent.click(await screen.findByRole("tab", { name: "Ghi chú" }));
    const input = await screen.findByRole("textbox", { name: "Ghi chú mới" });
    fireEvent.change(input, { target: { value: "Gửi lịch cho khách" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(input).toHaveValue("Gửi lịch cho khách");
  });
});

describe("MeetingRoomCopilotTab honesty", () => {
  it("shows the unshipped Q&A as one locked row, not a usable-looking input", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    await screen.findByRole("button", { name: "Sao chép" });
    expect(screen.getByText("Hỏi đáp về cuộc họp")).toBeInTheDocument();
    expect(screen.getByText("Sắp có")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Hỏi bất cứ điều gì/)).not.toBeInTheDocument();
  });

  it("labels the summary as AI output with the sources it really had and a dated time", async () => {
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      if (String(path).endsWith("/transcript")) {
        return Promise.resolve({ segments: [{ id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T07:00:00Z" }] });
      }
      return base?.(path, init);
    });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    const attribution = await screen.findByTestId("meeting-summary-attribution");
    expect(attribution).toHaveTextContent("AI");
    await waitFor(() => expect(attribution).toHaveTextContent("Tạo tự động từ bản ghi lời thoại ·"));
    expect(attribution).not.toHaveTextContent(/ghi chú|tin nhắn/);
    expect(attribution).toHaveTextContent(/22\/09\/2026|22\/9\/2026/);
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
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    await screen.findByRole("button", { name: "Sao chép" });
    expect(screen.queryByText("Đang ghi hình trực tiếp")).not.toBeInTheDocument();
  });

  it("wires each section tab to its panel", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
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
  render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
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

  function respond(opts: { summary?: unknown; motions?: unknown[] } = {}) {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/summary/tasks") && init?.method === "POST") {
        return Promise.resolve({ task_ids: ["t1"], items: [{ index: 0, task_id: "t1" }] });
      }
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

  function posted(): { summary_id?: string; items?: Record<string, unknown>[] } {
    const call = requestMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/summary/tasks") && (c[1] as { method?: string } | undefined)?.method === "POST",
    );
    return ((call?.[1] as { body?: unknown } | undefined)?.body ?? {}) as { summary_id?: string; items?: Record<string, unknown>[] };
  }

  it("asks before replacing the summary", async () => {
    respond({ motions: [closedMotion] });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    const button = await screen.findByRole("button", { name: "Tạo lại tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));

    fireEvent.click(button);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/summary", expect.objectContaining({ method: "POST" }));
  });

  it("counts a closed vote as something to summarise, like the server", async () => {
    respond({ summary: null, motions: [closedMotion] });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  });

  it("gives the new tasks the meeting's project and keeps the call to action for the returning focus", async () => {
    respond();
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" projectId="p1" canHost />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Viết ghi chú phát hành" }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => String(c[0]).includes("/projects/p1"))).toBe(true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo việc trong UniWork (1)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));

    await waitFor(() => expect(posted().items).toHaveLength(1));
    expect(posted()).toEqual({ summary_id: "s1", items: [{ index: 0, assignee_id: null, due_date: null, project_id: "p1" }] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Tạo việc trong UniWork (0)" })).toHaveAttribute("aria-disabled", "true");
  });

  it("says why it cannot generate yet, keeping the button reachable", async () => {
    respond({ summary: null });
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).toHaveAttribute("aria-describedby"));
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "Cần bản ghi lời thoại, ghi chú, tin nhắn hoặc kết quả biểu quyết",
    );
  });

  it("shows a guest the items read-only, without the create flow", async () => {
    respond();
    render(wrapWithNav(<MeetingRoomCopilotTab meetingId="m1" canHost />));
    fireEvent.click(await screen.findByRole("tab", { name: "Việc cần làm" }));
    expect(await screen.findByText("Viết ghi chú phát hành")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tạo việc trong UniWork/ })).not.toBeInTheDocument();
  });
});
