import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiKeys } from "@uniwork/core/ai";
import type { AskStreamState } from "@uniwork/core/ai/stream";
import { initI18n } from "@uniwork/core/i18n";
import { AiProposalSchema, type AiMessage } from "@uniwork/core/types";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniMessageTurn } from "./ask-uni-answer";
import { AskUniThread } from "./ask-uni-thread";
import { answerPlainText } from "./ask-uni-text";
import { capabilities } from "./ask-uni-fixtures";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

initI18n();

const long = "Á".repeat(100);
const user: User = { id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi" };
const workspace: Workspace = { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" };

function msg(over: Partial<AiMessage> = {}): AiMessage {
  return { id: "m1", role: "assistant", content: "Kết quả **chính**.", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", attachments: [], file_notes: [], proposals: [], memory_ids: [], memory_proposals: [], created_at: "", ...over };
}

function docRow(over: Record<string, unknown> = {}) {
  return AiProposalSchema.parse({
    id: "d1", message_id: "m1", position: 0, tool: "create_document", status: "applied", mode: "ask", can_undo: true,
    preview: { target: { kind: "document", id: "D1", title: "Tài liệu" }, fields: [], body: "", audience: { visibility: "", room_members: 0, notifies: [], notifies_more: false }, refs: [] },
    result: { href: "/acme/team/documents/D1" },
    ...over,
  });
}

function routes(enabled = true, title = "Họp", ceiling = "auto") {
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/ai/capabilities")) return Promise.resolve({ ...capabilities(), actions: { enabled, ceiling, mode: "ask" } });
    if (path.includes("/ai/conversations")) return Promise.resolve({ conversations: [{ id: "c1", title, created_at: "", updated_at: "", tainted: false }] });
    return Promise.resolve({});
  });
}

function mount(message: AiMessage) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(wrapWithNav(<AskUniMessageTurn message={message} conversationId="c1" wsId="ws1" onRegenerate={() => undefined} />, undefined, client));
  return { ...r, client };
}

// The gates read the capabilities query: nothing may be asserted absent before it has settled.
const capsLoaded = (client: QueryClient) => waitFor(() => expect(client.getQueryState(aiKeys.capabilities("ws1"))?.status).toBe("success"));

beforeEach(() => {
  requestMock.mockReset();
});

describe("Ask UNI answer actions: create", () => {
  it("opens the task dialog with the conversation title cut to 80 runes and the answer as plain text", async () => {
    routes(true, long);
    const source = { source_id: "S1", kind: "task", title: "Thiết kế trang chủ", quote: "", href: "/acme/team/tasks/T1" };
    const content = "Việc quá hạn [S1] cần làm trước.";
    mount(msg({ content, citations: [source] }));
    fireEvent.click(await screen.findByRole("button", { name: "Tạo công việc" }, { timeout: 4000 }));
    const title = await screen.findByRole("textbox", { name: "Tiêu đề issue" }, { timeout: 4000 });
    await waitFor(() => expect((title as HTMLInputElement).value).toBe("Á".repeat(80)));
    const expected = answerPlainText(content, new Map([["S1", source]]));
    expect(expected).not.toBe(content);
    expect(expected).toContain("Thiết kế trang chủ");
    const description = await screen.findByRole("textbox", { name: "Mô tả" }, { timeout: 4000 });
    await waitFor(() => expect(description.textContent).toBe(expected));
  });

  // UNI-2242: a follow-up's task was titled with the conversation's first question.
  it("titles the task with the question this answer replies to, as plain text", async () => {
    routes(true, "Mục tiêu của cuộc họp này là gì?");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      wrapWithNav(
        <AskUniMessageTurn message={msg()} question="Công việc của **từng người**?" conversationId="c1" wsId="ws1" />,
        undefined,
        client,
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tạo công việc" }, { timeout: 4000 }));
    const title = await screen.findByRole("textbox", { name: "Tiêu đề issue" }, { timeout: 4000 });
    expect((title as HTMLInputElement).value).toBe("Công việc của từng người?");
  });

  it("leaves the title empty when the conversation has none", async () => {
    routes(true, "");
    mount(msg());
    fireEvent.click(await screen.findByRole("button", { name: "Tạo công việc" }));
    const title = await screen.findByRole("textbox", { name: "Tiêu đề issue" });
    expect((title as HTMLInputElement).value).toBe("");
  });

  it("shows both buttons only with actions on and text in the answer", async () => {
    routes(false);
    const off = mount(msg());
    await capsLoaded(off.client);
    expect(screen.getByRole("button", { name: "Sao chép" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạo công việc" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tạo tài liệu" })).toBeNull();
    off.unmount();
    requestMock.mockReset();
    routes(true);
    const noText = mount(msg({ content: "", notice: "stopped" }));
    await capsLoaded(noText.client);
    expect(screen.getByRole("button", { name: "Trả lời lại" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạo công việc" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tạo tài liệu" })).toBeNull();
    noText.unmount();
    mount(msg());
    expect(await screen.findByRole("button", { name: "Tạo công việc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tạo tài liệu" })).toBeInTheDocument();
  });

  it("keeps Tạo tài liệu away when the organization turned UNI's changes off", async () => {
    routes(true, "Họp", "off");
    const { client } = mount(msg());
    await capsLoaded(client);
    // The server refuses the save under an off ceiling; creating a task by hand is not an Ask UNI change.
    expect(screen.getByRole("button", { name: "Tạo công việc" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạo tài liệu" })).toBeNull();
  });

  it("saves the answer as a document through the thread: the card shows the row and Regenerate goes", async () => {
    resetAuthStoreForTests();
    setSessionUser(user);
    let saved = false;
    const history = () => [
      { ...msg({ id: "u1", role: "user", content: "Tóm tắt" }) },
      { ...msg({ id: "a1", proposals: saved ? [docRow({ message_id: "a1" })] : [] }) },
    ];
    routes();
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "POST" && path.endsWith("/messages/a1/document")) {
        saved = true;
        return Promise.resolve(docRow({ message_id: "a1" }));
      }
      if (path.endsWith("/ai/conversations/c1/messages")) return Promise.resolve({ messages: history() });
      return base(path, init);
    });
    const idle: AskStreamState = { status: "idle", question: "", conversationId: "c1", draft: "", thinking: "", steps: [], sources: {}, followups: [], proposals: [], memoryProposals: [], memoryIds: [], regenerateOf: null, model: "", attachments: [], citations: [], message: null, errorCode: null };
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <AskUniThread conversationId="c1" stream={{ state: idle, ask: vi.fn(), stop: vi.fn() }} wsId="ws1" />
        </WorkspaceProvider>,
        undefined,
        new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      ),
    );
    expect(await screen.findByRole("button", { name: "Trả lời lại" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Tạo tài liệu" }));
    expect(await screen.findByRole("link", { name: "Mở" })).toHaveAttribute("href", "/acme/team/documents/D1");
    expect(screen.getByRole("button", { name: "Hoàn tác" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trả lời lại" })).toBeNull();
  });

  it("hides the document button once its row exists, but not for a failed one", async () => {
    routes();
    const applied = mount(msg({ proposals: [docRow()] }));
    await screen.findByRole("button", { name: "Tạo công việc" });
    expect(screen.queryByRole("button", { name: "Tạo tài liệu" })).toBeNull();
    applied.unmount();
    mount(msg({ proposals: [docRow({ status: "failed" })] }));
    expect(await screen.findByRole("button", { name: "Tạo tài liệu" })).toBeInTheDocument();
  });

  it("shows a short alert, not the server text, when saving fails", async () => {
    routes();
    mount(msg());
    const ok = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "POST" ? Promise.reject(new Error("SECRET server text")) : ok(path),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tạo tài liệu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không thực hiện được. Thử lại.");
    expect(screen.queryByText(/SECRET/)).toBeNull();
  });
});
