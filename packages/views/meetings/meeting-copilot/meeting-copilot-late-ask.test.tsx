import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingRoomCopilotTab } from "../meeting-room-copilot-tab";
import { lateJoinMinutes } from "./meeting-catch-up-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const brief = {
  summary: "Nhóm đã chốt lịch demo.",
  highlights: [
    { text: "Demo vào thứ Sáu", segment_id: "g1", spoken_at: "2026-10-21T02:05:00Z" },
    { text: "Ngân sách theo ghi chú" },
  ],
  action_items: [{ title: "Gửi bản demo", owner: "An", segment_id: "g2", spoken_at: "2026-10-21T02:10:00Z" }],
  generated_at: "2026-10-21T02:25:00Z",
  partial: false,
};

const answer = {
  conversation_id: "c1",
  message: {
    id: "a1",
    role: "assistant",
    content: "Lúc 09:05 An chốt demo thứ Sáu [S1].",
    notice: "",
    citations: [{ source_id: "S1", kind: "transcript", title: "Transcript: Giao ban", href: "/o/w/meetings/m1#transcript" }],
  },
};

const calls = (suffix: string) => requestMock.mock.calls.filter(([p]) => String(p).endsWith(suffix));

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/catch-up")) return Promise.resolve(brief);
    if (p.endsWith("/ai/capabilities")) return Promise.resolve({ enabled: true, ask_uni: true });
    if (p.endsWith("/ai/ask")) return Promise.resolve(answer);
    if (p.endsWith("/chat")) return Promise.resolve({ message: null });
    if (p.endsWith("/summary")) return Promise.resolve({ summary: null });
    if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
    if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
    if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
    return Promise.resolve({});
  });
});

describe("lateJoinMinutes", () => {
  const start = "2026-10-21T02:00:00Z";
  const at = (min: number) => Date.parse(start) + min * 60_000;
  it("offers the brief only from 10 minutes after the actual start", () => {
    expect(lateJoinMinutes(start, at(9.9))).toBeNull();
    expect(lateJoinMinutes(start, at(10))).toBe(10);
    expect(lateJoinMinutes(start, at(23.5))).toBe(23);
    expect(lateJoinMinutes(undefined, at(30))).toBeNull();
    expect(lateJoinMinutes("not a date", at(30))).toBeNull();
  });
});

describe("catch-up card (B7)", () => {
  it("costs nothing until clicked, then shows each point with its time", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost={false} lateMinutes={23} />));
    const button = await screen.findByRole("button", { name: "Bạn vào sau 23 phút — xem tóm tắt phần đã lỡ" });
    expect(calls("/catch-up")).toHaveLength(0);

    fireEvent.click(button);
    expect(await screen.findByText("Nhóm đã chốt lịch demo.")).toBeInTheDocument();
    expect(calls("/catch-up")).toHaveLength(1);
    expect(screen.getByText("Demo vào thứ Sáu").previousSibling).toHaveAttribute("datetime", "2026-10-21T02:05:00Z");
    expect(screen.getByText("Ngân sách theo ghi chú").previousSibling).toHaveTextContent("Ghi chú");
    expect(screen.getByText(/Gửi bản demo · An/)).toBeInTheDocument();
    expect(screen.getByText("Chỉ bạn thấy tóm tắt này.")).toBeInTheDocument();
  });

  it("is not offered to a member who came on time, nor without a workspace (a guest)", async () => {
    const { unmount } = render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost={false} lateMinutes={null} />));
    await screen.findByRole("tab", { name: "Tổng quan" });
    expect(screen.queryByTestId("meeting-catch-up-card")).not.toBeInTheDocument();
    unmount();

    render(wrapWithNav(<MeetingRoomCopilotTab meetingId="m1" canHost={false} lateMinutes={23} />));
    await screen.findByRole("tab", { name: "Tổng quan" });
    expect(screen.queryByTestId("meeting-catch-up-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-ask-uni")).not.toBeInTheDocument();
  });

  it("says so when the brief cannot be made", async () => {
    requestMock.mockImplementation((path: unknown) =>
      String(path).endsWith("/catch-up") ? Promise.reject(new Error("boom")) : Promise.resolve({}),
    );
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost={false} lateMinutes={15} />));
    fireEvent.click(await screen.findByRole("button", { name: /Bạn vào sau 15 phút/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tóm tắt được phần đã lỡ");
  });
});

describe("Hỏi UNI box (B8)", () => {
  it("asks Ask UNI about this meeting and shares the answer as the asker's chat message", async () => {
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost={false} />));
    const input = await screen.findByRole("textbox", { name: "Câu hỏi cho UNI về cuộc họp này" });
    fireEvent.change(input, { target: { value: "Đã chốt gì về demo?" } });
    fireEvent.click(screen.getByRole("button", { name: "Hỏi" }));

    expect(await screen.findByText(/An chốt demo thứ Sáu/)).toBeInTheDocument();
    const [, init] = calls("/ai/ask")[0]!;
    expect((init as { body: unknown }).body).toMatchObject({
      question: "Đã chốt gì về demo?",
      focus: { kind: "meeting", id: "m1" },
    });
    expect(screen.getByText("Chỉ bạn thấy câu trả lời này.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chia sẻ vào chat cuộc họp" }));
    const posts = () => calls("/meetings/m1/chat").filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0]![1] as { body: unknown }).body).toEqual({ message: "Lúc 09:05 An chốt demo thứ Sáu." });
  });

  it("stays hidden when Ask UNI is off for the workspace", async () => {
    requestMock.mockImplementation((path: unknown) =>
      String(path).endsWith("/ai/capabilities") ? Promise.resolve({ enabled: false }) : Promise.resolve({}),
    );
    render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canHost={false} />));
    await screen.findByRole("tab", { name: "Tổng quan" });
    await waitFor(() => expect(calls("/ai/capabilities").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("meeting-ask-uni")).not.toBeInTheDocument();
  });
});
