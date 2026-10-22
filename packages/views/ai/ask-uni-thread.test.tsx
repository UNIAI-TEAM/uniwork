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

const IDLE: AskStreamState = { status: "idle", question: "", conversationId: null, draft: "", steps: [], sources: {}, followups: [], regenerateOf: null, citations: [], message: null, errorCode: null };
const history = [
  { id: "u1", role: "user", content: "Task nào quá hạn?", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "" },
  { id: "a1", role: "assistant", content: "Có 3 task quá hạn.", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "" },
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
  return { ...r, update: (st: AskUniStream, conv: string | null = conversationId) => r.rerender(ui(st, conv)) };
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/v1/ai/conversations/c1/messages" ? { messages: history } : {}),
  );
  useAiPanelStore.setState({ conversationId: "c1", workspaceId: "ws1" });
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
    const s = stream({ status: "streaming", question: "Họp tuần?", draft: "Đang viết" });
    const m = mount(s);
    expect(await screen.findByText("Họp tuần?")).toBeInTheDocument();
    expect(screen.getByText("Đang viết")).toBeInTheDocument();
    m.update(stream({ status: "streaming", question: "Họp tuần?", draft: "", steps: [{ tool: "search", label: "quá hạn", counts: { task: 2 } }] }));
    expect(screen.queryByText("Đang viết")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Đang tìm “quá hạn”…");
  });

  it("shows the finished turn once and keeps its steps line", async () => {
    const answer = { id: "a2", role: "assistant", content: "Xong rồi.", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "" };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/ai/conversations/c1/messages"
          ? { messages: [...history, { id: "pending-a2", role: "user", content: "Còn gì nữa?", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "" }, answer] }
          : {},
      ),
    );
    mount(stream({ status: "done", question: "Còn gì nữa?", message: answer, steps: [{ tool: "search", label: "", counts: { meeting: 3 } }, { tool: "list_meetings", label: "", counts: {} }, { tool: "get_meeting", label: "Họp", counts: {} }] }));
    expect(await screen.findByText("Xong rồi.")).toBeInTheDocument();
    expect(screen.getAllByText("Xong rồi.")).toHaveLength(1);
    expect(screen.getAllByText("Còn gì nữa?")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Xong sau 3 bước" })).toBeInTheDocument();
  });

  it("shows a stored turn's steps after a reload, with no stream", async () => {
    const stepped = { ...history[1]!, steps: [{ tool: "search", label: "quá hạn", counts: {} }, { tool: "get_task", label: "A", counts: {} }] };
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
    const answer = { id: "a2", role: "assistant", content: "Chưa có trong cache.", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "" };
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Bạn hỏi quá nhanh");
  });

  it("falls back to the generic error for an unknown code", async () => {
    mount(stream({ status: "error", question: "Hỏi?", errorCode: "stream_ended" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không hỏi được lúc này");
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

const msg = (o: Record<string, unknown>) => ({ id: "x", role: "assistant", content: "", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "", ...o });
const serve = (messages: unknown[]) =>
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/v1/ai/conversations/c1/messages" ? { messages } : {}),
  );

describe("AskUniThread regenerate in place", () => {
  it("shows one question and the live answer where the old one was", async () => {
    mount(stream({ status: "streaming", question: "Task nào quá hạn?", draft: "Đang viết lại", regenerateOf: "a1" }));
    await screen.findByText("Task nào quá hạn?");
    expect(await screen.findByText("Đang viết lại")).toBeInTheDocument();
    expect(screen.queryByText("Có 3 task quá hạn.")).toBeNull();
    expect(screen.getAllByText("Task nào quá hạn?")).toHaveLength(1);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items.findIndex((x) => x.includes("Đang viết lại"))).toBe(items.findIndex((x) => x.includes("Task nào quá hạn?")) + 1);
  });

  it("brings the old answer back with an error when the regenerate fails", async () => {
    mount(stream({ status: "error", question: "Task nào quá hạn?", regenerateOf: "a1", errorCode: "ai_rate_limited" }));
    expect(await screen.findByText("Có 3 task quá hạn.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Bạn hỏi quá nhanh");
    expect(screen.getAllByText("Task nào quá hạn?")).toHaveLength(1);
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
    expect(s.ask).toHaveBeenCalledWith({ conversation_id: "c1", question: "A?", model: "opus", effort: "high", locale: "vi" });
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
