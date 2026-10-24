import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AiProposalSchema, type AiMessage } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniMessageTurn } from "./ask-uni-answer";
import { capabilities } from "./ask-uni-fixtures";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

initI18n();

const long = "Á".repeat(100);

function msg(over: Partial<AiMessage> = {}): AiMessage {
  return { id: "m1", role: "assistant", content: "Kết quả **chính**.", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", attachments: [], file_notes: [], proposals: [], created_at: "", ...over };
}

function docRow(over: Record<string, unknown> = {}) {
  return AiProposalSchema.parse({
    id: "d1", message_id: "m1", position: 0, tool: "create_document", status: "applied", mode: "ask", can_undo: true,
    preview: { target: { kind: "document", id: "D1", title: "Tài liệu" }, fields: [], body: "", audience: { visibility: "", room_members: 0, notifies: [], notifies_more: false }, refs: [] },
    result: { href: "/acme/team/documents/D1" },
    ...over,
  });
}

function routes(enabled = true, title = "Họp") {
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/ai/capabilities")) return Promise.resolve({ ...capabilities(), actions: { enabled, ceiling: "auto", mode: "ask" } });
    if (path.includes("/ai/conversations")) return Promise.resolve({ conversations: [{ id: "c1", title, created_at: "", updated_at: "", tainted: false }] });
    return Promise.resolve({});
  });
}

function mount(message: AiMessage) {
  return render(wrapWithNav(<AskUniMessageTurn message={message} conversationId="c1" wsId="ws1" onRegenerate={() => undefined} />));
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("Ask UNI answer actions: create", () => {
  it("opens the task dialog with the conversation title cut to 80 runes and the answer as description", async () => {
    routes(true, long);
    mount(msg({ content: "Kết quả chính." }));
    fireEvent.click(await screen.findByRole("button", { name: "Tạo công việc" }));
    const title = await screen.findByRole("textbox", { name: "Tiêu đề issue" });
    await waitFor(() => expect((title as HTMLTextAreaElement | HTMLInputElement).value).toBe("Á".repeat(80)));
    expect((await screen.findAllByText(/Kết quả chính/)).length).toBeGreaterThan(1);
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
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Tạo công việc" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tạo tài liệu" })).toBeNull();
    off.unmount();
    routes(true);
    const noText = mount(msg({ content: "", notice: "stopped" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Tạo công việc" })).toBeNull();
    noText.unmount();
    mount(msg());
    expect(await screen.findByRole("button", { name: "Tạo công việc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tạo tài liệu" })).toBeInTheDocument();
  });

  it("saves the answer as a document and the card shows the result, replacing Regenerate", async () => {
    routes();
    const ok = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, init?: { method?: string }) => (init?.method === "POST" ? Promise.resolve(docRow()) : ok(path)));
    const { rerender } = mount(msg());
    expect(await screen.findByRole("button", { name: "Trả lời lại" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Tạo tài liệu" }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => String(c[0]).endsWith("/messages/m1/document"))).toBe(true));
    // The hook splices the row into the messages cache; the thread then passes it down with the answer.
    rerender(wrapWithNav(<AskUniMessageTurn message={msg({ proposals: [docRow()] })} conversationId="c1" wsId="ws1" />));
    expect(screen.getByRole("link", { name: "Mở" })).toHaveAttribute("href", "/acme/team/documents/D1");
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
