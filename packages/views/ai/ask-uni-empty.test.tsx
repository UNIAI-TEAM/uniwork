import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { initI18n } from "@uniwork/core/i18n";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, requestStreamMock, streamResponse, wrapWithNav } from "../test/api-mock";
import { composerRoutes, user, workspace } from "./ask-uni-fixtures";
import { AskUniEmptyState } from "./ask-uni-empty";
import { AskUniPanel } from "./ask-uni-panel";

initI18n();

const SETS: Record<string, string[]> = {
  task: ["Tóm tắt task này", "Task này đang vướng ở đâu?", "Ai nên nhận task này?", "Việc nào liên quan đến task này?"],
  project: ["Tóm tắt tiến độ dự án này", "Việc nào của dự án đang trễ?", "Ai đang làm nhiều việc nhất trong dự án?", "Việc nào chưa có người làm?"],
  meeting: ["Tóm tắt cuộc họp này", "Cuộc họp này chốt những gì?", "Việc nào được giao trong cuộc họp?", "Cần chuẩn bị gì cho cuộc họp?"],
  document: ["Tóm tắt tài liệu này", "Tài liệu này nói gì về hạn chót?", "Việc nào liên quan đến tài liệu này?", "Ai phụ trách nội dung này?"],
  room: ["Tóm tắt trao đổi gần đây", "Có việc nào được nhắc mà chưa thành task?", "Ai đang chờ trả lời?", "Chốt được gì trong phòng này?"],
  other: ["Việc nào của tôi sắp trễ?", "Hôm nay tôi nên làm gì trước?", "Tóm tắt các cuộc họp tuần này", "Việc nào đang chờ tôi duyệt?"],
};

const buttons = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("AskUniEmptyState", () => {
  it.each(Object.keys(SETS).filter((k) => k !== "other"))("shows the four %s questions", (kind) => {
    render(<AskUniEmptyState kind={kind} onAsk={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Hỏi UNI về công việc" })).toBeInTheDocument();
    expect(buttons()).toEqual(SETS[kind]);
  });

  it("falls back to the other set for null, member and unknown kinds", () => {
    for (const kind of [null, "member", "email_thread"]) {
      const { unmount } = render(<AskUniEmptyState kind={kind} onAsk={vi.fn()} />);
      expect(buttons()).toEqual(SETS.other);
      unmount();
    }
  });

  it("welcomes with UNI for Auto and with Claude and the model's description for a Claude model", () => {
    const { unmount } = render(<AskUniEmptyState kind={null} onAsk={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Hỏi UNI về công việc" })).toBeInTheDocument();
    expect(screen.getByText("UNI chọn model hợp với từng câu hỏi.")).toBeInTheDocument();
    expect(document.querySelector("[data-mark]")).toHaveAttribute("data-mark", "uni");
    unmount();
    render(<AskUniEmptyState kind={null} onAsk={vi.fn()} model="opus" look="anthropic" />);
    expect(screen.getByRole("heading", { name: "Cần Claude tìm hiểu gì?" })).toBeInTheDocument();
    expect(screen.getByText("Suy luận sâu nhất, hợp câu hỏi phức tạp nhưng chậm và tốn hạn mức hơn.")).toBeInTheDocument();
    expect(document.querySelector("[data-mark]")).toHaveAttribute("data-mark", "anthropic");
  });

  it("asks the clicked question", () => {
    const onAsk = vi.fn();
    render(<AskUniEmptyState kind="task" onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: "Tóm tắt task này" }));
    expect(onAsk).toHaveBeenCalledWith("Tóm tắt task này");
  });

  it("blocks asking while disabled but keeps the buttons focusable", () => {
    const onAsk = vi.fn();
    render(<AskUniEmptyState kind="task" onAsk={onAsk} disabled />);
    const b = screen.getByRole("button", { name: "Tóm tắt task này" });
    expect(b).toHaveAttribute("aria-disabled", "true");
    expect(b).not.toBeDisabled();
    fireEvent.click(b);
    expect(onAsk).not.toHaveBeenCalled();
  });
});

describe("AskUniPanel empty state", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestStreamMock.mockReset();
    requestStreamMock.mockImplementation((..._args: unknown[]) => Promise.resolve(streamResponse([])) as never);
    requestMock.mockImplementation((path: string) => {
      if (path.endsWith("/ai/conversations")) return Promise.resolve({ conversations: [] });
      return composerRoutes(path);
    });
    useAiPanelStore.setState({ conversationId: null, workspaceId: "ws1", page: null, pageDismissed: null, pendingFocus: null, focus: null });
    useAskModelChoice.setState({ model: "", effort: "" });
    resetAuthStoreForTests();
    setSessionUser(user);
  });

  const mount = () =>
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <AskUniPanel />
        </WorkspaceProvider>,
      ),
    );

  const askBody = (): { question: string; focus?: { kind: string; id: string } } | undefined => {
    const call = requestStreamMock.mock.calls.find(([p]) => String(p).endsWith("/ai/ask/stream"));
    return (call?.[1] as { body?: ReturnType<typeof askBody> } | undefined)?.body;
  };

  it("sends a suggestion at once with the page focus", async () => {
    useAiPanelStore.setState({ page: { kind: "project", id: "p1", label: "Q4" } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Tóm tắt tiến độ dự án này" }));
    await vi.waitFor(() => expect(askBody()).toBeDefined());
    expect(askBody()).toMatchObject({ question: "Tóm tắt tiến độ dự án này", focus: { kind: "project", id: "p1" } });
  });

  it("shows the other set and sends no focus once the page chip is dismissed", async () => {
    useAiPanelStore.setState({ page: { kind: "project", id: "p1", label: "Q4" }, pageDismissed: "project:p1" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Hôm nay tôi nên làm gì trước?" }));
    await vi.waitFor(() => expect(askBody()).toBeDefined());
    expect(askBody()?.focus).toBeUndefined();
  });

  it("uses the other set on a member page kind", async () => {
    useAiPanelStore.setState({ page: { kind: "thread", id: "x", label: "" } });
    mount();
    expect(await screen.findByRole("button", { name: "Việc nào đang chờ tôi duyệt?" })).toBeInTheDocument();
  });

  it("takes Claude's look and welcome while a Claude model is picked, UNI's for Auto", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Hỏi UNI về công việc" })).toBeInTheDocument();
    const panel = document.querySelector('[data-slot="ask-uni-panel"]')!;
    expect(panel).not.toHaveAttribute("data-ask-provider");
    act(() => {
      useAskModelChoice.setState({ model: "opus" });
    });
    expect(await screen.findByRole("heading", { name: "Cần Claude tìm hiểu gì?" })).toBeInTheDocument();
    expect(panel).toHaveAttribute("data-ask-provider", "anthropic");
    // A model the organization switched off is Auto, and so is its look.
    act(() => {
      useAskModelChoice.setState({ model: "fable" });
    });
    expect(await screen.findByRole("heading", { name: "Hỏi UNI về công việc" })).toBeInTheDocument();
    expect(panel).not.toHaveAttribute("data-ask-provider");
  });

  it("is gone once a conversation is open", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/conversations/c1/messages") ? { messages: [{ id: "a1", role: "assistant", content: "Đã tải xong", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "" }] } : path.endsWith("/ai/conversations") ? { conversations: [] } : {}),
    );
    useAiPanelStore.setState({ conversationId: "c1" });
    mount();
    await screen.findByText("Đã tải xong");
    expect(screen.getByText("Đã tải xong")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hỏi UNI về công việc" })).toBeNull();
  });

  it("Ask about this with a conversation open starts over on that object's set", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/conversations/c1/messages") ? { messages: [{ id: "a1", role: "assistant", content: "Câu trả lời cũ", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "" }] } : path.endsWith("/ai/conversations") ? { conversations: [] } : {}),
    );
    useAiPanelStore.setState({ conversationId: "c1" });
    mount();
    await screen.findByText("Câu trả lời cũ");
    act(() => useAiPanelStore.getState().openWithFocus({ kind: "meeting", id: "M", label: "Họp tuần" }));
    expect(useAiPanelStore.getState().conversationId).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Tóm tắt cuộc họp này" }));
    await vi.waitFor(() => expect(askBody()).toBeDefined());
    expect(askBody()?.focus).toEqual({ kind: "meeting", id: "M" });
    expect(screen.queryByText("Câu trả lời cũ")).toBeNull();
  });

  it("hides while the first turn streams", async () => {
    requestStreamMock.mockImplementation((..._args: unknown[]) => new Promise(() => {}) as never);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Hôm nay tôi nên làm gì trước?" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Hỏi UNI về công việc" })).toBeNull());
  });

  it("two quick clicks send one request", async () => {
    mount();
    const b = await screen.findByRole("button", { name: "Hôm nay tôi nên làm gì trước?" });
    fireEvent.click(b);
    fireEvent.click(b);
    await vi.waitFor(() => expect(askBody()).toBeDefined());
    expect(requestStreamMock.mock.calls.filter(([p]) => String(p).endsWith("/ai/ask/stream"))).toHaveLength(1);
  });

  it("a hand-picked focus beats the page for the set, the chip and the send", async () => {
    useAiPanelStore.setState({ page: { kind: "project", id: "P", label: "Dự án P" }, pendingFocus: { kind: "task", id: "T", label: "Việc T" } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Tóm tắt task này" }));
    await vi.waitFor(() => expect(askBody()).toBeDefined());
    expect(askBody()?.focus).toEqual({ kind: "task", id: "T" });
  });

  it("removing the hand-picked chip brings the page set back", async () => {
    useAiPanelStore.setState({ page: { kind: "project", id: "P", label: "Dự án P" }, focus: { kind: "task", id: "T", label: "Việc T" } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Bỏ phạm vi.*Việc T/ }));
    expect(await screen.findByRole("button", { name: "Tóm tắt tiến độ dự án này" })).toBeInTheDocument();
  });
});
