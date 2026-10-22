import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import type { AskStreamState } from "@uniwork/core/ai/stream";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniThread, type AskUniStream } from "./ask-uni-thread";

initI18n();

const IDLE: AskStreamState = { status: "idle", question: "", conversationId: null, draft: "", counts: {}, citations: [], message: null, errorCode: null };
const history = [
  { id: "u1", role: "user", content: "Task nào quá hạn?", notice: "", citations: [], created_at: "" },
  { id: "a1", role: "assistant", content: "Có 3 task quá hạn.", notice: "", citations: [], created_at: "" },
];

function stream(state: Partial<AskStreamState> = {}): AskUniStream {
  return { state: { ...IDLE, conversationId: "c1", ...state }, ask: vi.fn(), stop: vi.fn() };
}

function mount(s: AskUniStream, conversationId: string | null = "c1", askDefaults?: { model: string; effort: string; locale: string }) {
  // One client across rerenders: a fresh one per render would drop the cache the thread is testing.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (st: AskUniStream, conv: string | null) =>
    wrapWithNav(<AskUniThread conversationId={conv} stream={st} askDefaults={askDefaults} />, undefined, client);
  const r = render(ui(s, conversationId));
  return { ...r, update: (st: AskUniStream, conv: string | null = conversationId) => r.rerender(ui(st, conv)) };
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/v1/ai/conversations/c1/messages" ? { messages: history } : {}),
  );
  useAiPanelStore.setState({ conversationId: "c1", workspaceId: "ws1" });
});

describe("AskUniThread", () => {
  it("lists the stored turns", async () => {
    mount(stream());
    expect(await screen.findByText("Có 3 task quá hạn.")).toBeInTheDocument();
    expect(screen.getByText("Task nào quá hạn?")).toBeInTheDocument();
  });

  it("streaming draft shows and clears on step", async () => {
    const s = stream({ status: "streaming", question: "Họp tuần?", draft: "Đang viết" });
    const m = mount(s);
    expect(await screen.findByText("Họp tuần?")).toBeInTheDocument();
    expect(screen.getByText("Đang viết")).toBeInTheDocument();
    m.update(stream({ status: "streaming", question: "Họp tuần?", draft: "", counts: { task: 2 } }));
    expect(screen.queryByText("Đang viết")).toBeNull();
    expect(screen.getByRole("button", { name: /Đã xem 2 task/ })).toBeInTheDocument();
  });

  it("shows the finished turn once and keeps its steps line", async () => {
    const answer = { id: "a2", role: "assistant", content: "Xong rồi.", notice: "", citations: [], created_at: "" };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/ai/conversations/c1/messages"
          ? { messages: [...history, { id: "pending-a2", role: "user", content: "Còn gì nữa?", notice: "", citations: [], created_at: "" }, answer] }
          : {},
      ),
    );
    mount(stream({ status: "done", question: "Còn gì nữa?", message: answer, counts: { meeting: 3 } }));
    expect(await screen.findByText("Xong rồi.")).toBeInTheDocument();
    expect(screen.getAllByText("Xong rồi.")).toHaveLength(1);
    expect(screen.getAllByText("Còn gì nữa?")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Đã xem 3 cuộc họp/ })).toBeInTheDocument();
  });

  it("shows the finished answer from the stream until the cache has it", async () => {
    const answer = { id: "a2", role: "assistant", content: "Chưa có trong cache.", notice: "", citations: [], created_at: "" };
    mount(stream({ status: "done", question: "Hỏi mới?", message: answer }));
    expect(await screen.findByText("Chưa có trong cache.")).toBeInTheDocument();
    expect(screen.getByText("Hỏi mới?")).toBeInTheDocument();
  });

  it("regenerate re-asks the last question in the same conversation", async () => {
    const s = stream();
    mount(s);
    fireEvent.click(await screen.findByRole("button", { name: "Trả lời lại" }));
    expect(s.ask).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: "c1", question: "Task nào quá hạn?" }));
  });

  it("regenerate sends the composer's model, effort and language", async () => {
    const s = stream();
    mount(s, "c1", { model: "opus", effort: "high", locale: "vi" });
    fireEvent.click(await screen.findByRole("button", { name: "Trả lời lại" }));
    expect(s.ask).toHaveBeenCalledWith({
      conversation_id: "c1", question: "Task nào quá hạn?", model: "opus", effort: "high", locale: "vi",
    });
  });

  it("offers regenerate on the last answer only, and not while streaming", async () => {
    const s = stream({ status: "streaming", question: "Mới?", draft: "..." });
    mount(s);
    await screen.findByText("Có 3 task quá hạn.");
    expect(screen.getByRole("button", { name: "Trả lời lại" })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the error text for a stream error", async () => {
    mount(stream({ status: "error", question: "Hỏi?", errorCode: "ai_rate_limited" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bạn đang hỏi quá nhanh");
  });

  it("falls back to the generic error for an unknown code", async () => {
    mount(stream({ status: "error", question: "Hỏi?", errorCode: "stream_ended" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa gửi được câu hỏi");
  });

  it("a new conversation's turn is not adopted by whichever conversation opens before run", async () => {
    const fresh = stream({ status: "streaming", question: "Câu mới", draft: "x", conversationId: null });
    const m = mount(fresh, null);
    expect(await screen.findByText("Câu mới")).toBeInTheDocument();
    m.update(fresh, "c5");
    expect(screen.queryByText("Câu mới")).toBeNull();
    m.update(stream({ status: "streaming", question: "Câu mới", draft: "x", conversationId: "c9" }), "c9");
    expect(await screen.findByText("Câu mới")).toBeInTheDocument();
  });

  it("does not hide a stopped turn because the history loaded after it", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/ai/conversations/c1/messages" ? new Promise((r) => (resolve = r)) : Promise.resolve({}),
    );
    const m = mount(stream({ status: "streaming", question: "Hỏi", draft: "một phần" }));
    m.update(stream({ status: "stopped", question: "Hỏi", draft: "một phần" }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => c[0] === "/api/v1/ai/conversations/c1/messages")).toBe(true));
    resolve({ messages: history });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(await screen.findByText("Có 3 task quá hạn.")).toBeInTheDocument();
    expect(screen.getByText("một phần")).toBeInTheDocument();
  });

  it("marks the list busy while streaming", async () => {
    mount(stream({ status: "streaming", question: "Hỏi", draft: "x" }));
    await screen.findByText("Hỏi");
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
  });
});
