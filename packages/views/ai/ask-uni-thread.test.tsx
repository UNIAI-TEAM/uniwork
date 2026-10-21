import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import type { AskStreamState } from "@uniwork/core/ai/stream";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniThread, type AskUniStream } from "./ask-uni-thread";

initI18n();

const IDLE: AskStreamState = { status: "idle", question: "", draft: "", counts: {}, citations: [], message: null, errorCode: null };
const history = [
  { id: "u1", role: "user", content: "Task nào quá hạn?", notice: "", citations: [], created_at: "" },
  { id: "a1", role: "assistant", content: "Có 3 task quá hạn.", notice: "", citations: [], created_at: "" },
];

function stream(state: Partial<AskStreamState> = {}): AskUniStream {
  return { state: { ...IDLE, ...state }, ask: vi.fn(), stop: vi.fn() };
}

function mount(s: AskUniStream, conversationId: string | null = "c1") {
  const ui = (st: AskUniStream) => wrapWithNav(<AskUniThread conversationId={conversationId} stream={st} />);
  const r = render(ui(s));
  return { ...r, update: (st: AskUniStream) => r.rerender(ui(st)) };
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

  it("offers regenerate on the last answer only, and not while streaming", async () => {
    const s = stream({ status: "streaming", question: "Mới?", draft: "..." });
    mount(s);
    await screen.findByText("Có 3 task quá hạn.");
    expect(screen.getByRole("button", { name: "Trả lời lại" })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the error text for a stream error", async () => {
    mount(stream({ status: "error", question: "Hỏi?", errorCode: "ai_rate_limited" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bạn hỏi quá nhanh");
  });

  it("falls back to the generic error for an unknown code", async () => {
    mount(stream({ status: "error", question: "Hỏi?", errorCode: "stream_ended" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không hỏi được lúc này");
  });

  it("does not show another conversation's live turn", async () => {
    const s = stream({ status: "streaming", question: "Câu của hội thoại khác", draft: "x" });
    const m = mount(s);
    await screen.findByText("Câu của hội thoại khác");
    useAiPanelStore.setState({ conversationId: "c2" });
    m.unmount();
    mount(s, "c2");
    await waitFor(() => expect(screen.getByText("Câu của hội thoại khác")).toBeInTheDocument());
  });
});
