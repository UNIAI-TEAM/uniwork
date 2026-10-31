import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { AiProposalSchema, type AiProposal } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { composerRoutes, user, workspace } from "./ask-uni-fixtures";
import { AskUniProposalCard } from "./ask-uni-proposal-card";

initI18n();

type Field = { field: string; type: string; from?: unknown; to: unknown; options?: string[] };

function row(fields: Field[], over: Record<string, unknown> = {}): AiProposal {
  return AiProposalSchema.parse({
    id: "p1",
    message_id: "m1",
    position: 1,
    tool: "update_task",
    status: "pending",
    mode: "ask",
    preview: { target: { kind: "task", id: "T1", title: "Viết spec" }, fields, body: "", refs: [] },
    ...over,
  });
}

function mount(p: AiProposal) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniProposalCard message={{ id: "m1", proposals: [p] }} conversationId="c1" />
      </WorkspaceProvider>,
    ),
  );
}

const edit = (p: AiProposal) => {
  mount(p);
  fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
};
const save = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Lưu" })));
const patches = () => requestMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === "PATCH") as [string, { body: unknown }][];

async function pickDay(label: string, day: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await screen.findAllByRole("gridcell", {}, { timeout: 20_000 });
  fireEvent.click(screen.getAllByRole("gridcell").map((c) => c.querySelector("button")).find((b) => b?.textContent === day)!);
}

const TASK: Field[] = [
  { field: "title", type: "text", from: "Cũ", to: "Cũ" },
  { field: "due_date", type: "date", from: "2026-10-23", to: "2026-10-23" },
  { field: "priority", type: "enum", from: "medium", to: "medium", options: ["low", "medium", "high"] },
  { field: "status", type: "enum", from: "todo", to: "Đang làm", options: ["Cần làm", "Đang làm"] },
  { field: "labels", type: "labels", from: [], to: ["a", "b"] },
  { field: "parent_task_id", type: "text", from: null, to: "Task cha" },
];

beforeAll(async () => {
  await import("@uniwork/ui/components/ui/calendar");
}, 60_000);

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => (path === "/api/v1/ai/proposals/p1" ? Promise.resolve(row(TASK)) : composerRoutes(path)));
});

describe("AskUniProposalEdit", () => {
  it("sends only the title and the due date that changed", async () => {
    edit(row(TASK));
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa Tiêu đề" }), { target: { value: "Mới" } });
    await pickDay("Sửa Hạn", "10");
    await save();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]![1].body).toEqual({ changes: { title: "Mới", due_date: "2026-10-10" } });
    // The server accepted: the form closes.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Lưu" })).toBeNull());
  });

  it("keeps labels, parent and the task status read-only", () => {
    edit(row(TASK));
    expect(screen.queryByLabelText("Sửa Nhãn")).toBeNull();
    expect(screen.queryByLabelText("Sửa Task cha")).toBeNull();
    expect(screen.queryByLabelText("Sửa Trạng thái")).toBeNull();
    expect(screen.getByLabelText("Sửa Độ ưu tiên")).toBeInTheDocument();
    expect(screen.getAllByText("Nhãn").length).toBeGreaterThan(0);
  });

  it("shows a refusal at the field it names and keeps the form open with what was typed", async () => {
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/ai/proposals/p1" ? Promise.reject(new ApiError("title must be 1-200 characters", "invalid_args", 400)) : composerRoutes(path),
    );
    edit(row(TASK));
    const title = screen.getByRole("textbox", { name: "Sửa Tiêu đề" });
    fireEvent.change(title, { target: { value: "Mới" } });
    await save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Tiêu đề không hợp lệ. Sửa lại rồi lưu.");
    expect(alert).not.toHaveTextContent("title must be");
    expect(title.parentElement).toContainElement(alert);
    expect(title).toHaveValue("Mới");
    expect(screen.getByRole("button", { name: "Lưu" })).toBeEnabled();
  });

  it("shows a refusal that names no field under the form", async () => {
    requestMock.mockImplementation((path: string) => (path === "/api/v1/ai/proposals/p1" ? Promise.reject(new ApiError("nothing to change", "invalid_args", 400)) : composerRoutes(path)));
    edit(row(TASK));
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa Tiêu đề" }), { target: { value: "Mới" } });
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Thay đổi này không hợp lệ. Sửa lại rồi lưu.");
    expect(screen.getByRole("textbox", { name: "Sửa Tiêu đề" })).toHaveValue("Mới");
  });

  it("closes on Hủy without a call", () => {
    edit(row(TASK));
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(screen.queryByRole("button", { name: "Lưu" })).toBeNull();
    expect(patches()).toHaveLength(0);
  });

  it("edits the text of a message row as body", async () => {
    edit(row([], { tool: "send_chat_message", preview: { target: { kind: "chat", id: "r1", title: "general" }, fields: [], body: "Chào" } }));
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa Nội dung" }), { target: { value: "Chào cả nhà" } });
    await save();
    await waitFor(() => expect(patches()[0]![1].body).toEqual({ changes: { body: "Chào cả nhà" } }));
  });

  it("offers Sửa on a row whose only editable field is markdown", () => {
    mount(row([{ field: "description", type: "markdown", from: "a", to: "b" }, { field: "status", type: "enum", from: "todo", to: "Xong", options: ["Xong"] }]));
    expect(screen.getByRole("button", { name: "Sửa" })).toBeInTheDocument();
  });

  it("offers no Sửa when every field is read-only", () => {
    mount(row([{ field: "labels", type: "labels", from: [], to: ["a"] }, { field: "attendee_ids", type: "person", to: ["Lan"] }]));
    expect(screen.queryByRole("button", { name: "Sửa" })).toBeNull();
  });

  it("sends the id of the project picked", async () => {
    edit(row([{ field: "project_id", type: "project", from: "Cũ", to: "Cũ" }]));
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa Dự án" }), { target: { value: "web" } });
    fireEvent.click(await screen.findByRole("option", { name: /Web\s*site/ }, { timeout: 3000 }));
    await save();
    await waitFor(() => expect(patches()[0]![1].body).toEqual({ changes: { project_id: "p1" } }));
  });

  it("sends the meeting start as an instant", async () => {
    const f = { field: "starts_at", type: "datetime", from: "2026-10-15T03:00:00Z", to: "2026-10-15T03:00:00Z" };
    edit(row([f], { tool: "update_meeting", preview: { target: { kind: "meeting", id: "M", title: "H" }, fields: [f] } }));
    await pickDay("Bắt đầu", "10");
    await save();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect((patches()[0]![1].body as { changes: { starts_at: string } }).changes.starts_at).toMatch(/^2026-10-10T\d\d:\d\d:00Z$/);
  });

  it("names the hour and minute of the start and the end apart", () => {
    const start = { field: "starts_at", type: "datetime", from: null, to: "2026-10-15T03:00:00Z" };
    const end = { field: "ends_at", type: "datetime", from: null, to: "2026-10-15T03:30:00Z" };
    edit(row([start, end], { tool: "schedule_meeting", preview: { target: { kind: "meeting", id: "", title: "H" }, fields: [start, end] } }));
    for (const name of ["Giờ bắt đầu", "Phút bắt đầu", "Giờ kết thúc", "Phút kết thúc"]) expect(screen.getAllByRole("textbox", { name })).toHaveLength(1);
  });

  it("clears a date with null", async () => {
    edit(row(TASK));
    fireEvent.click(screen.getByRole("button", { name: "Sửa Hạn" }));
    fireEvent.click(await screen.findByText("Bỏ chọn ngày"));
    await save();
    await waitFor(() => expect(patches()[0]![1].body).toEqual({ changes: { due_date: null } }));
  });

  it("clears a datetime with null", async () => {
    const f = { field: "starts_at", type: "datetime", from: "2026-10-15T03:00:00Z", to: "2026-10-15T03:00:00Z" };
    edit(row([f], { tool: "update_meeting", preview: { target: { kind: "meeting", id: "M", title: "H" }, fields: [f] } }));
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu" }));
    fireEvent.click(await screen.findByText("Bỏ chọn ngày"));
    await save();
    await waitFor(() => expect(patches()[0]![1].body).toEqual({ changes: { starts_at: null } }));
  });

  it("edits a page edit's text as its content, in one box", async () => {
    const mode = { field: "mode", type: "enum", from: null, to: "append" };
    edit(row([mode], { tool: "update_document", preview: { target: { kind: "document", id: "D1", title: "Trang" }, fields: [mode], body: "Cũ" } }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa Nội dung" }), { target: { value: "Mới" } });
    await save();
    await waitFor(() => expect(patches()[0]![1].body).toEqual({ changes: { content: "Mới" } }));
  });

  it("still shows a refusal when a field key holds regex characters", async () => {
    requestMock.mockImplementation((path: string) => (path === "/api/v1/ai/proposals/p1" ? Promise.reject(new ApiError("a(b is not valid", "invalid_args", 400)) : composerRoutes(path)));
    edit(row([{ field: "a(b", type: "text", from: "x", to: "x" }]));
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa a(b" }), { target: { value: "y" } });
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("a(b không hợp lệ");
  });

  it("edits the content of a page UNI drafts as content", async () => {
    const title = { field: "title", type: "text", from: null, to: "Trang" };
    edit(row([title], { tool: "create_document", preview: { target: { kind: "document", id: "", title: "Trang" }, fields: [title], body: "Cũ" } }));
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa Nội dung" }), { target: { value: "Mới" } });
    await save();
    await waitFor(() => expect(patches()[0]![1].body).toEqual({ changes: { content: "Mới" } }));
  });

  it("edits the reason of a cancellation as reason", async () => {
    const status = { field: "status", type: "enum", from: "SCHEDULED", to: "CANCELED" };
    edit(row([status], { tool: "cancel_meeting", preview: { target: { kind: "meeting", id: "M", title: "Họp" }, fields: [status], body: "Bận" } }));
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa Lý do" }), { target: { value: "Dời sang tuần sau" } });
    await save();
    await waitFor(() => expect(patches()[0]![1].body).toEqual({ changes: { reason: "Dời sang tuần sau" } }));
  });

  const cutPage = { target: { kind: "document", id: "", title: "Trang" }, body: "Phần đầu", body_truncated: true };

  it("keeps a page body that was cut to fit the card read-only", () => {
    const title = { field: "title", type: "text", from: null, to: "Trang" };
    edit(row([title], { tool: "create_document", preview: { ...cutPage, fields: [title] } }));
    expect(screen.getByRole("textbox", { name: "Sửa Tiêu đề" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Sửa Nội dung" })).toBeNull();
  });

  it("offers no Sửa when a cut page body is all there is", () => {
    mount(row([], { tool: "create_document", preview: { ...cutPage, fields: [] } }));
    expect(screen.getByText("Phần đầu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sửa" })).toBeNull();
  });

  it("labels the visibility options of a new Office file", () => {
    edit(row([{ field: "visibility", type: "enum", from: null, to: "restricted", options: ["restricted", "workspace"] }], { tool: "create_office_document" }));
    expect(screen.getByLabelText("Sửa Ai xem được")).toHaveTextContent("Chỉ mình tôi");
  });
});
