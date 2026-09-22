import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
