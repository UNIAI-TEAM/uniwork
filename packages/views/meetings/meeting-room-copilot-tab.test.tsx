import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomCopilotTab } from "./meeting-room-copilot-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  initI18n();
});

const summary = {
  id: "s1",
  meeting_id: "m1",
  summary: "- Chốt lịch phát hành",
  decisions: ["Phát hành thứ Sáu"],
  action_items: [{ title: "Viết ghi chú phát hành" }, { title: "Báo khách hàng" }],
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

  it("labels the summary as AI output with its sources and a dated time", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost />));
    const attribution = await screen.findByTestId("meeting-summary-attribution");
    expect(attribution).toHaveTextContent("AI");
    expect(attribution).toHaveTextContent(/bản ghi lời thoại, ghi chú và trò chuyện/);
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

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
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
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
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
