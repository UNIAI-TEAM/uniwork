import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
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
    useAiPanelStore.setState({ conversationId: null, workspaceId: "ws1", page: null, pageDismissed: null, pendingFocus: null });
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

  it("is gone once a conversation is open", async () => {
    useAiPanelStore.setState({ conversationId: "c1" });
    mount();
    expect(screen.queryByRole("heading", { name: "Hỏi UNI về công việc" })).toBeNull();
  });
});
