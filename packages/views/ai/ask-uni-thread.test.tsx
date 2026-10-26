import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import type { AskStreamState } from "@uniwork/core/ai/stream";
import { initI18n } from "@uniwork/core/i18n";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniThread, type AskUniStream } from "./ask-uni-thread";

initI18n();

// The thread's timing is not under test here; use-smooth-text.test.tsx holds the reveal.
vi.mock("./use-smooth-text", () => ({ useSmoothText: (text: string) => text }));

// Long enough to be shown while it streams; a call's short lead-in is held back.
const LONG = "Có 3 việc quá hạn. ".repeat(10);
const IDLE: AskStreamState = { status: "idle", question: "", conversationId: null, draft: "", thinking: "", steps: [], sources: {}, followups: [], proposals: [], memoryProposals: [], memoryIds: [], regenerateOf: null, model: "", attachments: [], citations: [], message: null, errorCode: null };
const history = [
  { id: "u1", role: "user", content: "Task nào quá hạn?", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", created_at: "" },
  { id: "a1", role: "assistant", content: "Có 3 task quá hạn.", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", created_at: "" },
];

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

function stream(state: Partial<AskStreamState> = {}): AskUniStream {
  return { state: { ...IDLE, conversationId: "c1", ...state }, ask: vi.fn(), stop: vi.fn() };
}

function mount(s: AskUniStream, conversationId: string | null = "c1", askDefaults?: { model: string; effort: string; locale: string }) {
  // One client across rerenders: a fresh one per render would drop the cache the thread is testing.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (st: AskUniStream, conv: string | null) =>
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniThread conversationId={conv} stream={st} askDefaults={askDefaults} wsId="ws1" />
      </WorkspaceProvider>,
      undefined,
      client,
    );
  const r = render(ui(s, conversationId));
  return { ...r, client, update: (st: AskUniStream, conv: string | null = conversationId) => r.rerender(ui(st, conv)) };
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/v1/ai/conversations/c1/messages" ? { messages: history } : {}),
  );
  useAiPanelStore.setState({ conversationId: "c1", workspaceId: "ws1", page: null, focus: null, pageDismissed: null });
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("AskUniThread", () => {
  it("lists the stored turns", async () => {
    mount(stream());
    expect(await screen.findByText("Có 3 task quá hạn.")).toBeInTheDocument();
    expect(screen.getByText("Task nào quá hạn?")).toBeInTheDocument();
  });

  it("streaming draft shows and clears on step", async () => {
    const s = stream({ status: "streaming", question: "Họp tuần?", draft: LONG });
    const m = mount(s);
    expect(await screen.findByText("Họp tuần?")).toBeInTheDocument();
    expect(screen.getByText(LONG.trim())).toBeInTheDocument();
    m.update(stream({ status: "streaming", question: "Họp tuần?", draft: "", steps: [{ tool: "search", label: "quá hạn", counts: { task: 2 }, note: "", thought: "", kind: "" }] }));
    expect(screen.queryByText(LONG.trim())).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Đang tìm “quá hạn”…");
  });

  it("holds back a call's short lead-in, so the text a step clears never flashes", async () => {
    const lead = "Để tôi tra cứu các việc trong workspace.";
    const steps = [{ tool: "search", label: "quá hạn", counts: { task: 2 }, note: "", thought: "", kind: "" }];
    const m = mount(stream({ status: "streaming", question: "Họp tuần?", draft: lead }));
    expect(await screen.findByText("Họp tuần?")).toBeInTheDocument();
    expect(screen.queryByText(lead)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("UNI đang suy nghĩ…");
    m.update(stream({ status: "streaming", question: "Họp tuần?", draft: "", steps }));
    expect(screen.getByRole("status")).toHaveTextContent("Đang tìm “quá hạn”…");
    m.update(stream({ status: "streaming", question: "Họp tuần?", draft: LONG, steps }));
    expect(screen.getByText(LONG.trim())).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Đang viết câu trả lời…");
  });

  it("shows the finished turn once and keeps its steps line", async () => {
    const answer = { id: "a2", role: "assistant", content: "Xong rồi.", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", attachments: [], file_notes: [], proposals: [], memory_ids: [], memory_proposals: [], created_at: "" };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/ai/conversations/c1/messages"
          ? { messages: [...history, { id: "pending-a2", role: "user", content: "Còn gì nữa?", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", created_at: "" }, answer] }
          : {},
      ),
    );
    mount(stream({ status: "done", question: "Còn gì nữa?", message: answer, steps: [{ tool: "search", label: "", counts: { meeting: 3 }, note: "", thought: "", kind: "" }, { tool: "list_meetings", label: "", counts: {}, note: "", thought: "", kind: "" }, { tool: "get_meeting", label: "Họp", counts: {}, note: "", thought: "", kind: "" }] }));
    expect(await screen.findByText("Xong rồi.")).toBeInTheDocument();
    expect(screen.getAllByText("Xong rồi.")).toHaveLength(1);
    expect(screen.getAllByText("Còn gì nữa?")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Xong sau 3 bước" })).toBeInTheDocument();
  });

  it("shows a stored turn's steps after a reload, with no stream", async () => {
    const stepped = { ...history[1]!, steps: [{ tool: "search", label: "quá hạn", counts: {}, note: "", thought: "", kind: "" }, { tool: "get_task", label: "A", counts: {}, note: "", thought: "", kind: "" }] };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/ai/conversations/c1/messages" ? { messages: [history[0], stepped] } : {}),
    );
    mount(stream());
    expect(await screen.findByRole("button", { name: "Xong sau 2 bước" })).toBeInTheDocument();
  });

  it("gives a stopped turn with no text no copy or rating buttons, and keeps them when it has text", async () => {
    const stopped = (id: string, content: string) => ({ ...history[1]!, id, content, notice: "stopped" });
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/ai/conversations/c1/messages" ? { messages: [history[0], stopped("a-empty", "")] } : {}),
    );
    const empty = mount(stream());
    expect(await screen.findByText(/Đã dừng/)).toBeInTheDocument();
    for (const name of ["Sao chép", "Hữu ích", "Chưa đúng"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getByRole("button", { name: "Trả lời lại" })).toBeInTheDocument();
    empty.unmount();
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/ai/conversations/c1/messages" ? { messages: [history[0], stopped("a-text", "Một phần")] } : {}),
    );
    mount(stream());
    expect(await screen.findByText("Một phần")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sao chép" })).toBeInTheDocument();
  });

  it("shows the finished answer from the stream until the cache has it", async () => {
    const answer = { id: "a2", role: "assistant", content: "Chưa có trong cache.", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", attachments: [], file_notes: [], proposals: [], memory_ids: [], memory_proposals: [], created_at: "" };
    mount(stream({ status: "done", question: "Hỏi mới?", message: answer }));
    expect(await screen.findByText("Chưa có trong cache.")).toBeInTheDocument();
    expect(screen.getByText("Hỏi mới?")).toBeInTheDocument();
  });

  it("regenerate re-asks the last question in the same conversation", async () => {
    const s = stream();
    mount(s);
    fireEvent.click(await screen.findByRole("button", { name: "Trả lời lại" }));
    expect(s.ask).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: "c1", question: "Task nào quá hạn?", regenerate_message_id: "a1" }),
    );
  });

  it("regenerate sends the composer's model, effort and language", async () => {
    const s = stream();
    mount(s, "c1", { model: "opus", effort: "high", locale: "vi" });
    fireEvent.click(await screen.findByRole("button", { name: "Trả lời lại" }));
    expect(s.ask).toHaveBeenCalledWith({
      conversation_id: "c1", question: "Task nào quá hạn?", regenerate_message_id: "a1", model: "opus", effort: "high", locale: "vi",
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
    // The loaded history re-renders its rows, so read both lines from the settled screen, not from a node found before it.
    await waitFor(() => {
      expect(screen.getByText("Có 3 task quá hạn.")).toBeInTheDocument();
      expect(screen.getByText("một phần")).toBeInTheDocument();
    });
  });

  it("marks the list busy while streaming", async () => {
    mount(stream({ status: "streaming", question: "Hỏi", draft: "x" }));
    await screen.findByText("Hỏi");
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
  });

  it("keeps a reader at the bottom when the box shrinks, and leaves one who scrolled up", async () => {
    // The memory strip above the composer shrinks the thread's box without changing its content.
    let resized = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      mount(stream());
      await screen.findByText("Có 3 task quá hạn.");
      const box = screen.getByRole("list").parentElement as HTMLElement;
      Object.defineProperty(box, "scrollHeight", { configurable: true, value: 900 });
      Object.defineProperty(box, "clientHeight", { configurable: true, value: 100 });
      Object.defineProperty(box, "scrollTop", { configurable: true, writable: true, value: 800 });
      fireEvent.scroll(box);
      box.scrollTop = 750; // the box shrank by 50px: still pinned, now 50px short of the bottom
      act(() => resized());
      expect(box.scrollTop).toBe(900);

      box.scrollTop = 0;
      fireEvent.scroll(box);
      act(() => resized());
      expect(box.scrollTop).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("AskUniThread sources", () => {
  it("resolves a marker through an earlier answer's citations", async () => {
    const earlier = { source_id: "S2", kind: "project", title: "Ra mắt Q4", quote: "", href: "/acme/team/projects/P1" };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/ai/conversations/c1/messages"
          ? {
              messages: [
                { ...history[0], id: "u0" },
                { ...history[1], id: "a0", content: "Có dự án [S2].", citations: [earlier] },
                { ...history[0], id: "u2" },
                { ...history[1], id: "a2", content: "Nhắc lại 4 bước [S2]:", citations: [] },
              ],
            }
          : {},
      ),
    );
    mount(stream());
    expect(await screen.findAllByRole("link", { name: "Dự án: Ra mắt Q4" })).toHaveLength(2);
  });
});

const msg = (o: Record<string, unknown>) => ({ id: "x", role: "assistant", content: "", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", created_at: "", ...o });
const serve = (messages: unknown[]) =>
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/v1/ai/conversations/c1/messages" ? { messages } : {}),
  );

describe("AskUniThread regenerate in place", () => {
  it("shows one question and the live answer where the old one was", async () => {
    mount(stream({ status: "streaming", question: "Task nào quá hạn?", draft: LONG, regenerateOf: "a1" }));
    await screen.findByText("Task nào quá hạn?");
    expect(await screen.findByText(LONG.trim(), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("Có 3 task quá hạn.")).toBeNull();
    expect(screen.getAllByText("Task nào quá hạn?")).toHaveLength(1);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items.findIndex((x) => x.includes(LONG.trim()))).toBe(items.findIndex((x) => x.includes("Task nào quá hạn?")) + 1);
  });

  it("brings the old answer back, with its follow-ups and an error, when the regenerate fails", async () => {
    serve([history[0], { ...history[1], followups: ["A?", "B?"] }]);
    mount(stream({ status: "error", question: "Task nào quá hạn?", regenerateOf: "a1", errorCode: "ai_rate_limited" }));
    expect(await screen.findByText("Có 3 task quá hạn.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Bạn đang hỏi quá nhanh");
    expect(screen.getAllByText("Task nào quá hạn?")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "A?" })).toBeInTheDocument();
  });

  it("shows no follow-ups under a stopped regenerate, and the stored partial decides after the refetch", async () => {
    serve([history[0], { ...history[1], followups: ["A?"] }]);
    const m = mount(stream({ status: "stopped", question: "Task nào quá hạn?", regenerateOf: "a1", draft: "một phần" }));
    await screen.findByText("Có 3 task quá hạn.");
    expect(screen.queryByRole("button", { name: "A?" })).toBeNull();
    serve([history[0], msg({ id: "a3", content: "một phần", notice: "stopped", followups: ["Z?"] })]);
    await m.client.invalidateQueries();
    expect(await screen.findByText("một phần")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Z?" })).toBeNull();
  });
});

describe("AskUniThread follow-ups", () => {
  const withFollowups = [history[0], { ...history[1], followups: ["A?", "B?"] }];

  it("offers the last answer's follow-ups and asks the clicked one in the same conversation", async () => {
    serve(withFollowups);
    const s = stream();
    mount(s, "c1", { model: "opus", effort: "high", locale: "vi" });
    fireEvent.click(await screen.findByRole("button", { name: "A?" }));
    expect(screen.getByRole("button", { name: "B?" })).toBeInTheDocument();
    expect(s.ask).toHaveBeenCalledWith({ conversation_id: "c1", question: "A?", mentions: [], model: "opus", effort: "high", locale: "vi" });
  });

  it("takes the live turn's follow-ups for an answer the stream just finished", async () => {
    serve([history[0], history[1], msg({ id: "a2", content: "Xong." })]);
    mount(stream({ status: "done", question: "Q", followups: ["Tiếp?"], message: msg({ id: "a2", content: "Xong." }) as never }));
    expect(await screen.findByRole("button", { name: "Tiếp?" })).toBeInTheDocument();
  });

  it("hides them for an answer with a notice, an earlier answer, and while streaming", async () => {
    serve([history[0], { ...history[1], followups: ["Cũ?"] }, msg({ id: "u2", role: "user", content: "Hai" }), msg({ id: "a2", content: "", notice: "refused", followups: ["Z?"] })]);
    const m = mount(stream());
    await screen.findByText("Hai");
    expect(screen.queryByRole("button", { name: "Z?" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cũ?" })).toBeNull();
    serve(withFollowups);
    m.update(stream({ status: "streaming", question: "Mới", draft: "x" }));
    expect(screen.queryByRole("button", { name: "A?" })).toBeNull();
  });
});

describe("AskUniThread meta and context", () => {
  it("names the asker and UNI with the time, and no time for an unreadable date", async () => {
    serve([msg({ id: "u1", role: "user", content: "Hỏi", created_at: "2026-01-02T08:05:00Z" }), msg({ id: "a1", content: "Đáp", created_at: "not a date" })]);
    mount(stream());
    await screen.findByText("Đáp");
    expect(screen.getByText(/^An ·/)).toBeInTheDocument();
    expect(screen.getByText("UNI")).toBeInTheDocument();
    expect(screen.getByText("UNI").textContent).not.toMatch(/\d:\d\d/);
  });

  it("shows only the time for today and the date with it for an older message", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0));
    serve([
      msg({ id: "u1", role: "user", content: "Cũ", created_at: new Date(2026, 5, 3, 8, 5).toISOString() }),
      msg({ id: "a1", content: "Nay", created_at: new Date(2026, 5, 15, 9, 30).toISOString() }),
    ]);
    try {
      mount(stream());
      await screen.findByText("Nay");
      expect(screen.getByText("An · 3/6 08:05")).toBeInTheDocument();
      // The answer's name is set apart from its time.
      expect(screen.getByText("UNI").parentElement).toHaveTextContent(/^UNI · 09:30$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("links a focus and a mention to their objects and leaves an unknown kind plain", async () => {
    serve([
      msg({
        id: "u1", role: "user", content: "Hỏi",
        focus: { kind: "task", id: "t1", title: "Sửa lỗi" },
        mentions: [{ kind: "member", id: "m1", title: "Bình" }, { kind: "mystery", id: "z", title: "Lạ" }],
      }),
      msg({ id: "a1", content: "Đáp" }),
    ]);
    mount(stream());
    expect(await screen.findByRole("link", { name: /Sửa lỗi/ })).toHaveAttribute("href", "/acme/team/tasks/t1");
    expect(screen.getByRole("link", { name: /Bình/ })).toHaveAttribute("href", "/acme/team/people/m1");
    expect(screen.getByText("Lạ")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Lạ/ })).toBeNull();
  });
});

describe("AskUniThread own citations", () => {
  const task = { source_id: "S1", kind: "task", title: "Thiết kế trang chủ", quote: "", href: "/acme/team/tasks/T1" };
  const project = { source_id: "S1", kind: "project", title: "Website mới", quote: "", href: "/acme/team/projects/P1" };

  it("renders and copies each turn's own S1 when two turns number different objects S1", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    serve([
      msg({ id: "u1", role: "user", content: "Một" }),
      msg({ id: "a1", content: "Việc [S1]", citations: [task] }),
      msg({ id: "u2", role: "user", content: "Hai" }),
      msg({ id: "a2", content: "Dự án [S1]", citations: [project] }),
    ]);
    mount(stream());
    expect(await screen.findByRole("link", { name: /Thiết kế trang chủ/ })).toHaveAttribute("href", task.href);
    expect(screen.getByRole("link", { name: "Dự án: Website mới" })).toHaveAttribute("href", project.href);
    const copies = screen.getAllByRole("button", { name: "Sao chép" });
    fireEvent.click(copies[0]!);
    fireEvent.click(copies[1]!);
    expect(writeText.mock.calls.map((c) => c[0])).toEqual(["Việc Thiết kế trang chủ", "Dự án Website mới"]);
  });

  it("does not let another conversation's finished stream rename this one's sources or show its turn", async () => {
    serve([
      msg({ id: "u1", role: "user", content: "Tiến độ dự án?" }),
      msg({ id: "a1", content: "Có [S1].", citations: [project] }),
      msg({ id: "u2", role: "user", content: "Các task?" }),
      msg({ id: "a2", content: "Các task của [S1]:", citations: [] }),
    ]);
    const other = msg({ id: "aA", content: "Ở A: [S1]", citations: [task] });
    mount(stream({ status: "done", conversationId: "cA", question: "Câu của A", message: other as never, citations: [task], sources: { S1: task }, followups: ["A tiếp?"] }));
    expect(await screen.findAllByRole("link", { name: "Dự án: Website mới" })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Thiết kế trang chủ/ })).toBeNull();
    for (const text of ["Câu của A", "Ở A:", "A tiếp?"]) expect(screen.queryByText(new RegExp(text))).toBeNull();
  });
});

describe("AskUniThread follow-up focus", () => {
  it("a follow-up carries the page chip as its focus, as the composer would", async () => {
    serve([history[0], { ...history[1], followups: ["A?"] }]);
    useAiPanelStore.setState({ page: { kind: "task", id: "t9", label: "Sửa lỗi" }, pageDismissed: null, focus: null });
    const s = stream();
    mount(s, "c1", { model: "opus", effort: "high", locale: "vi" });
    fireEvent.click(await screen.findByRole("button", { name: "A?" }));
    expect(s.ask).toHaveBeenCalledWith({
      conversation_id: "c1", question: "A?", focus: { kind: "task", id: "t9" }, mentions: [], model: "opus", effort: "high", locale: "vi",
    });
  });
});

describe("AskUniThread files", () => {
  const pdf = { id: "file-1", name: "bao-cao.pdf", mime: "application/pdf", size: 2048, kind: "pdf" };

  it("shows the attached files on the question while the answer streams, without a way to download them", async () => {
    mount(stream({ status: "streaming", question: "Tóm tắt giúp", draft: "x", attachments: [pdf] }));
    expect(await screen.findByText("Tóm tắt giúp")).toBeInTheDocument();
    expect(screen.getByText("bao-cao.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải bao-cao.pdf" })).toBeNull();
  });

  it("shows a stored question's files as downloads", async () => {
    serve([msg({ id: "u9", role: "user", content: "Đọc file", attachments: [{ ...pdf, id: "att-9" }] }), msg({ id: "a9", content: "Xong." })]);
    mount(stream());
    expect(await screen.findByRole("button", { name: "Tải bao-cao.pdf" })).toBeInTheDocument();
  });

  it("writes what UNI read under a stored answer", async () => {
    const note = { name: "bao-cao.pdf", unit: "page", read: 15, total: 80 };
    serve([msg({ id: "u9", role: "user", content: "Đọc file" }), msg({ id: "a9", content: "Xong.", file_notes: [note] })]);
    mount(stream());
    expect(await screen.findByText("UNI đã đọc trang 1–15 trên 80 trang của bao-cao.pdf")).toBeInTheDocument();
  });

  it("writes it under the answer the stream just finished, before the cache has it", async () => {
    const note = { name: "bao-cao.pdf", unit: "page", read: 15, total: 80 };
    const answer = msg({ id: "a2", content: "Chưa có trong cache.", file_notes: [note] });
    mount(stream({ status: "done", question: "Hỏi mới?", message: answer as never }));
    expect(await screen.findByText("UNI đã đọc trang 1–15 trên 80 trang của bao-cao.pdf")).toBeInTheDocument();
  });

  it("words the attachment refusals instead of showing a code", async () => {
    const m = mount(stream({ status: "error", question: "Hỏi?", errorCode: "media_unsupported" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("UNI chưa đọc được loại file này");
    for (const [code, text] of [
      ["ai_attachments_unavailable", "Chưa dùng được file đính kèm"],
      ["ai_attachments_invalid", "File đính kèm không hợp lệ"],
      ["ai_attachments_too_large", "File đính kèm quá lớn"],
      ["ai_attachment_unreadable", "UNI không mở được một file đính kèm"],
    ] as const) {
      m.update(stream({ status: "error", question: "Hỏi?", errorCode: code }));
      expect(screen.getByRole("alert")).toHaveTextContent(text);
      expect(screen.getByRole("alert")).not.toHaveTextContent(code);
    }
  });
  it("hides regenerate on an answer with proposals and shows its card", async () => {
    const proposal = { id: "p1", message_id: "a1", position: 1, tool: "create_task", status: "pending", mode: "ask", preview: { target: { kind: "task", id: "", title: "Viết spec" }, fields: [] } };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/ai/conversations/c1/messages"
          ? { messages: [history[0], { ...history[1], proposals: [proposal] }] }
          : path.endsWith("/ai/capabilities")
            ? { enabled: true, ask_uni: true, actions: { enabled: true, ceiling: "plan", mode: "ask" } }
            : {},
      ),
    );
    mount(stream());
    expect(await screen.findByText("UNI đề xuất · cần bạn xác nhận")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sao chép" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trả lời lại" })).toBeNull();
  });

  it("hides regenerate on an answer with memory proposals", async () => {
    const mem = { id: "p1", message_id: "a1", position: 0, action: "remember", memory_id: "", kind: "fact", text: "Tôi là kế toán", before_kind: "", before_text: "", status: "pending", expires_at: "" };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/ai/conversations/c1/messages"
          ? { messages: [history[0], { ...history[1], memory_proposals: [mem] }] }
          : path.endsWith("/ai/capabilities")
            ? { enabled: true, ask_uni: true, memory: { enabled: true, on: true } }
            : {},
      ),
    );
    mount(stream());
    expect(await screen.findByText("Nhớ điều này?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sao chép" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trả lời lại" })).toBeNull();
  });
});
