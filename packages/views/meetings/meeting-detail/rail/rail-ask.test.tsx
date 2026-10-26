import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext } from "../detail-context";
import { demo, detailValue, fixtureMeeting, type MeetingFixtureKey } from "../test-fixtures";
import { askPlaceholderTitle, RailAsk } from "./rail-ask";

const ws = `/api/v1/workspaces/${demo.workspace.id}`;
const answer = {
  conversation_id: "c1",
  message: { id: "msg1", role: "assistant", content: "Thứ Sáu 30/10.", notice: "", steps: [], followups: [], focus: null, mentions: [], model: "", attachments: [], file_notes: [], created_at: "2026-10-23T14:18:00Z" },
};

function serve(ask: () => Promise<unknown>, extra: Record<string, () => Promise<unknown>> = {}) {
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path).split("?")[0]!;
    if (p === `${ws}/ai/capabilities`) return Promise.resolve({ enabled: true, ask_uni: true });
    if (p === `${ws}/ai/ask` && init?.method === "POST") return ask();
    for (const [suffix, answerOf] of Object.entries(extra)) if (p.endsWith(suffix)) return answerOf();
    return Promise.resolve({});
  });
}

function renderAsk(key: MeetingFixtureKey = "m1") {
  render(
    wrapWithNav(
      <DetailContext.Provider value={detailValue(key)}>
        <RailAsk />
      </DetailContext.Provider>,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  useAiPanelStore.getState().reset();
});

describe("RailAsk", () => {
  it("names the meeting, asks with it as the focus and opens the answer in the Ask UNI panel", async () => {
    serve(() => Promise.resolve(answer));
    renderAsk();
    const box = await screen.findByPlaceholderText("Hỏi về Giao ban tuần 43…");
    fireEvent.change(box, { target: { value: "Khi nào khóa tính năng?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(useAiPanelStore.getState().open).toBe(true));
    expect(requestMock).toHaveBeenCalledWith(
      `${ws}/ai/ask`,
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ question: "Khi nào khóa tính năng?", focus: expect.objectContaining({ kind: "meeting", id: fixtureMeeting("m1").id }) }),
      }),
    );
    expect(useAiPanelStore.getState().conversationId).toBe("c1");
    expect(box).toHaveValue("");
  });

  it("does not take ⌘J, which stays the global Ask UNI", async () => {
    serve(() => Promise.resolve(answer));
    renderAsk();
    await screen.findByPlaceholderText("Hỏi về Giao ban tuần 43…");
    fireEvent.keyDown(document, { key: "j", metaKey: true });
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));
    expect(screen.queryByText("⌘J")).not.toBeInTheDocument();
  });

  it("keeps the typed question when the ask fails, says so and sends it again", async () => {
    serve(() => Promise.reject(new ApiError("offline", "", 0)));
    renderAsk();
    const box = await screen.findByPlaceholderText("Hỏi về Giao ban tuần 43…");
    fireEvent.change(box, { target: { value: "Khi nào khóa tính năng bản 3.0?" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi câu hỏi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa gửi được câu hỏi. Kiểm tra mạng rồi hỏi lại.");
    expect(box).toHaveValue("Khi nào khóa tính năng bản 3.0?");
    expect(box).toHaveAttribute("aria-invalid", "true");
    serve(() => Promise.resolve(answer));
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại" }));
    await waitFor(() => expect(useAiPanelStore.getState().open).toBe(true));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps Enter for an IME still composing a word, and Shift+Enter for a new line", async () => {
    serve(() => Promise.resolve(answer));
    renderAsk();
    const box = await screen.findByPlaceholderText("Hỏi về Giao ban tuần 43…");
    fireEvent.change(box, { target: { value: "Khi" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(requestMock).not.toHaveBeenCalledWith(`${ws}/ai/ask`, expect.anything());
  });

  it("offers the catch-up chip only while live, and asks for the brief on click", async () => {
    const catchUp = `/meetings/${fixtureMeeting("m4").id}/catch-up`;
    serve(() => Promise.resolve(answer), {
      [catchUp]: () => Promise.resolve({ summary: "Đã chốt khoanh vùng lỗi QR.", highlights: [], action_items: [], partial: false, generated_at: "2026-10-23T14:18:00Z" }),
    });
    renderAsk("m4");
    fireEvent.click(await screen.findByRole("button", { name: "Tóm tắt từ đầu đến giờ" }));
    expect(await screen.findByText("Đã chốt khoanh vùng lỗi QR.")).toBeInTheDocument();
  });

  it("has no catch-up chip once the meeting is over", async () => {
    serve(() => Promise.resolve(answer));
    renderAsk("m1");
    await screen.findByPlaceholderText("Hỏi về Giao ban tuần 43…");
    expect(screen.queryByRole("button", { name: "Tóm tắt từ đầu đến giờ" })).not.toBeInTheDocument();
  });

  it("cuts the title to what fits the rail", () => {
    expect(askPlaceholderTitle("Giao ban tuần 43 — Ra mắt SaoMai POS 3.0")).toBe("Giao ban tuần 43");
    expect(askPlaceholderTitle("Họp nhanh xử lý sự cố thanh toán POS")).toBe("Họp nhanh xử lý");
    expect(askPlaceholderTitle("Standup")).toBe("Standup");
  });
});
