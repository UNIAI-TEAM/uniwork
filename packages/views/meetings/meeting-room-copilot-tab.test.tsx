import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomCopilotTab } from "./meeting-room-copilot-tab";

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
    expect(screen.queryByText(/Chưa có transcript/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Chưa có tóm tắt/)).not.toBeInTheDocument();
  });

  it("says there is no transcript once everything arrived empty", async () => {
    copilotRespond({});
    renderCopilot();

    expect(await screen.findByText(/Chưa có transcript/)).toBeInTheDocument();
  });

  it("offers a retry on the overview when the summary fails", async () => {
    copilotRespond({ summary: failed });
    renderCopilot();

    expect(await screen.findByText("Không tải được tóm tắt.")).toBeInTheDocument();
    copilotRespond({});
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(/Chưa có transcript/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((s) => within(s).queryByText("Đang tải…"))).toBe(true);
    expect(screen.queryByText(/Chưa có transcript/)).not.toBeInTheDocument();
  });

  it("offers a retry for the transcript when it fails", async () => {
    copilotRespond({ transcript: failed });
    renderCopilot();
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    expect(await screen.findByText("Không tải được transcript.")).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có transcript/)).not.toBeInTheDocument();
  });
});
