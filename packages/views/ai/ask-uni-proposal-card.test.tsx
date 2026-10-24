import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { AiProposalSchema, type AiProposal } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { user, workspace } from "./ask-uni-fixtures";
import { AskUniProposalCard } from "./ask-uni-proposal-card";

initI18n();

function row(over: Record<string, unknown> = {}): AiProposal {
  return AiProposalSchema.parse({
    id: "p1",
    message_id: "m1",
    position: 1,
    tool: "update_task",
    status: "pending",
    mode: "ask",
    preview: {
      target: { kind: "task", id: "T1", title: "Viết spec" },
      fields: [{ field: "status", type: "enum", from: "todo", to: "done", options: [] }],
      body: "",
      audience: { visibility: "", room_members: 0, notifies: [], notifies_more: false },
      refs: [],
    },
    ...over,
  });
}

function mount(proposals: AiProposal[], readOnly = false) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniProposalCard message={{ id: "m1", proposals }} conversationId="c1" readOnly={readOnly} />
      </WorkspaceProvider>,
    ),
  );
}

const pageRow = (mode: string) =>
  row({ id: "pd", position: 0, tool: "create_document", mode, preview: { target: { kind: "document", id: "", title: "Trang" }, fields: [], body: "Nội dung" } });

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});

describe("AskUniProposalCard", () => {
  it("renders a pending ask card", () => {
    const titled = (id: string, position: number) => row({ id, position, preview: { target: { kind: "task", id: "T1", title: "Viết spec" }, fields: [{ field: "title", type: "text", from: "a", to: "b" }, { field: "status", type: "enum", from: "todo", to: "done" }] } });
    mount([titled("p1", 1), titled("p2", 2)]);
    expect(screen.getByText("UNI đề xuất · cần bạn xác nhận")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Áp dụng" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Sửa" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Bỏ qua" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Áp dụng tất cả" })).toBeInTheDocument();
    expect(screen.getAllByText("Trạng thái")).toHaveLength(2);
    expect(screen.getAllByText("Cần làm")).toHaveLength(2);
    expect(screen.getAllByText("Hoàn thành")).toHaveLength(2);
  });

  it("offers apply-all only from two pending rows", () => {
    mount([row()]);
    expect(screen.queryByRole("button", { name: "Áp dụng tất cả" })).toBeNull();
  });

  it("applies one row", async () => {
    requestMock.mockResolvedValue(row({ status: "applied" }));
    mount([row()]);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/proposals/p1/apply", expect.objectContaining({ method: "POST" })));
  });

  it("renders a plan with checkboxes", async () => {
    requestMock.mockResolvedValue({ proposals: [] });
    mount([row({ id: "p1", mode: "plan" }), row({ id: "p2", position: 2, mode: "plan", preview: { target: { kind: "task", id: "", title: "Gửi" }, fields: [], refs: [1] } }), row({ id: "p3", position: 3, mode: "plan" })]);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    boxes.forEach((b) => expect(b).toBeChecked());
    expect(screen.getByText("dùng kết quả của bước 1")).toBeInTheDocument();
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Duyệt kế hoạch (2 bước)" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const [path, init] = requestMock.mock.calls[0] as [string, { body: unknown }];
    expect(path).toBe("/api/v1/ai/conversations/c1/messages/m1/proposals/apply");
    expect(init.body).toEqual({ proposal_ids: ["p1", "p3"] });
  });

  it("counts plan steps in English with the right plural", async () => {
    await act(async () => {
      await setLocale("en");
    });
    mount([row({ id: "p1", mode: "plan" })]);
    expect(screen.getByRole("button", { name: "Approve plan (1 step)" })).toBeInTheDocument();
  });

  it("stops asking to pick steps once no step of the plan waits", () => {
    const done = { status: "applied", can_undo: true, result: { object_id: "T1", href: "/acme/team/tasks/T1", revision: 2, changes: [], note: "" } };
    mount([row({ id: "p1", mode: "plan", ...done }), row({ id: "p2", position: 2, mode: "plan", status: "rejected" })]);
    expect(screen.queryByText(/chọn bước cần làm/)).toBeNull();
    expect(screen.getByRole("region", { name: "Đề xuất của UNI" })).toBeInTheDocument();
  });

  it("shows a comment body verbatim", () => {
    const body = "Dòng 1\n**đậm** <b>x</b> https://a.b";
    const { container } = mount([
      row({
        tool: "add_comment",
        preview: {
          target: { kind: "task", id: "T1", title: "Viết spec" },
          fields: [],
          body,
          audience: { visibility: "task", room_members: 0, notifies: [{ kind: "member", id: "u2", title: "Lan" }], notifies_more: false },
          refs: [],
        },
      }),
    ]);
    const el = screen.getByText((_, n) => n?.textContent === body && n.tagName === "P");
    expect(el.className).toContain("whitespace-pre-wrap");
    expect(container.querySelector("strong, b, a")).toBeNull();
    expect(screen.getByText("Ai sẽ thấy:")).toBeInTheDocument();
    expect(screen.getByText(/Báo cho Lan/)).toBeInTheDocument();
  });

  it("shows applied with open and undo", async () => {
    requestMock.mockResolvedValue(row({ status: "undone" }));
    mount([row({ status: "applied", can_undo: true, result: { object_id: "T1", href: "/acme/team/tasks/T1", revision: 2, changes: [], note: "" } })]);
    const open = screen.getByRole("link", { name: "Mở" });
    expect(open).toHaveAttribute("href", "/acme/team/tasks/T1");
    // The link wears the outline button: its border is the input colour, not the base's transparent one.
    expect(open.className).toContain("border-input");
    expect(open.className).not.toContain("border-transparent");
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/proposals/p1/undo", expect.anything()));
  });

  it("shows no undo without can_undo", () => {
    mount([row({ status: "applied", can_undo: false })]);
    expect(screen.queryByRole("button", { name: "Hoàn tác" })).toBeNull();
  });

  it.each([
    ["rejected", "Đã bỏ qua"],
    ["undone", "Đã hoàn tác"],
    ["expired", "Đã hết hạn"],
  ])("shows %s faded with no buttons", (status, text) => {
    const { container } = mount([row({ status })]);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("li")?.className).toContain("opacity-60");
  });

  it.each([
    ["revision_conflict", "Hỏi lại UNI để lấy đề xuất mới"],
    ["not_found", "Không tìm thấy đối tượng này"],
    ["invalid_args", "Đề xuất này không hợp lệ"],
    ["proposal_expired", "Đề xuất đã hết hạn"],
    ["ai_actions_disabled", "đang tắt hành động ghi"],
    ["ai_write_rate_limited", "Áp dụng quá nhanh"],
    ["undo_unavailable", "đã có người sửa sau đó"],
    ["proposal_ref_pending", "Áp dụng bước đó trước"],
    ["proposal_not_pending", "đã được xử lý"],
    ["whatever_new", "Không áp dụng được. Hỏi lại UNI."],
  ])("shows the failed copy for %s", (code, text) => {
    mount([row({ status: "failed", error_code: code })]);
    expect(within(screen.getByRole("alert")).getByText(new RegExp(text))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Áp dụng" })).toBeNull();
  });

  it("tells to open the object when the outcome is unknown", () => {
    mount([row({ status: "unknown", result: { object_id: "T1", href: "/acme/team/tasks/T1", revision: 0, changes: [], note: "" } })]);
    expect(screen.getByText("Chưa rõ kết quả. Mở đối tượng để kiểm tra.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a spinner while applying", () => {
    mount([row({ status: "applying" })]);
    expect(screen.getByText("Đang áp dụng…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("treats a status it does not know as neutral with no buttons", () => {
    mount([row({ status: "paused_by_future" })]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("survives value shapes it does not expect", () => {
    mount([
      row({
        preview: {
          target: { kind: "task", id: "T1", title: "x" },
          fields: [
            { field: "weird", type: "text", from: { a: { b: 1 } }, to: [1, { name: "Lan" }, null] },
            { field: "due_date", type: "date", from: "2026-10-23", to: "not a date" },
            { field: "labels", type: "labels", from: ["a"], to: ["a", "b"] },
          ],
        },
      }),
    ]);
    expect(screen.getByText("(không đọc được)")).toBeInTheDocument();
    expect(screen.getByText("not a date")).toBeInTheDocument();
    expect(screen.getByText("a, b")).toBeInTheDocument();
  });

  it("edits the title of a pending row", async () => {
    requestMock.mockResolvedValue(row());
    mount([row({ preview: { target: { kind: "task", id: "", title: "" }, fields: [{ field: "title", type: "text", from: "", to: "Cũ" }] } })]);
    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Sửa Tiêu đề" }), { target: { value: "Mới" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Lưu" })));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/proposals/p1", expect.objectContaining({ method: "PATCH", body: { changes: { title: "Mới" } } })));
  });

  it("applies all pending rows in position order", async () => {
    requestMock.mockResolvedValue({ proposals: [] });
    mount([row({ id: "p2", position: 2 }), row({ id: "p1", position: 1 })]);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng tất cả" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect((requestMock.mock.calls[0] as [string, { body: unknown }])[1].body).toEqual({ proposal_ids: ["p1", "p2"] });
  });
  it("labels the meeting fields the server emits", () => {
    const { container } = mount([
      row({
        tool: "schedule_meeting",
        preview: {
          target: { kind: "meeting", id: "", title: "Họp" },
          fields: ["starts_at", "ends_at", "timezone", "attendee_ids", "user_ids", "lead_id", "parent_id"].map((field) => ({ field, type: "text", from: null, to: "x" })),
        },
      }),
    ]);
    for (const label of ["Bắt đầu", "Kết thúc", "Múi giờ", "Người tham dự", "Người được mời", "Người dẫn dắt", "Nằm trong"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/starts_at|ends_at|attendee_ids|user_ids|lead_id|parent_id/);
    // schedule_meeting makes a new meeting: there is no old value, so no "(trống) →".
    expect(container.textContent).not.toMatch(/trống|→/);
  });

  it("shows a page edit's text once, with how it lands", () => {
    const { container } = mount([
      row({ tool: "update_document", preview: { target: { kind: "document", id: "D1", title: "Ghi chú" }, fields: [{ field: "mode", type: "enum", from: null, to: "append" }], body: "## Cảm ơn" } }),
      row({ id: "p2", position: 2, tool: "update_document", preview: { target: { kind: "document", id: "D2", title: "Khác" }, fields: [{ field: "mode", type: "enum", from: null, to: "replace" }], body: "Mới" } }),
    ]);
    expect(screen.getByText("Thêm vào cuối tài liệu")).toBeInTheDocument();
    expect(screen.getByText("Thay toàn bộ tài liệu")).toBeInTheDocument();
    expect(screen.getAllByText("## Cảm ơn")).toHaveLength(1);
    expect(container.textContent).not.toMatch(/trống|→/);
  });

  it("labels the project and meeting status enums", () => {
    mount([
      row({ id: "a", tool: "update_project", preview: { target: { kind: "project", id: "P", title: "D" }, fields: [{ field: "status", type: "enum", from: "planned", to: "paused" }] } }),
      row({ id: "b", position: 2, tool: "cancel_meeting", preview: { target: { kind: "meeting", id: "M", title: "H" }, fields: [{ field: "status", type: "enum", from: "SCHEDULED", to: "CANCELED" }] } }),
    ]);
    for (const t of ["Đã lên kế hoạch", "Tạm dừng", "Đã lên lịch", "Đã hủy"]) expect(screen.getByText(t)).toBeInTheDocument();
  });

  it("offers Sửa only on a row with something to edit", () => {
    mount([
      row({ id: "a", preview: { target: { kind: "task", id: "T1", title: "x" }, fields: [{ field: "title", type: "text", from: "a", to: "b" }] } }),
      row({ id: "b", position: 2, tool: "cancel_meeting", preview: { target: { kind: "meeting", id: "M", title: "H" }, fields: [{ field: "status", type: "enum", from: "SCHEDULED", to: "CANCELED" }] } }),
      row({ id: "c", position: 3, tool: "add_comment", preview: { target: { kind: "task", id: "T", title: "x" }, fields: [], body: "hi" } }),
    ]);
    expect(screen.getAllByRole("button", { name: "Sửa" })).toHaveLength(2);
  });

  it("takes its mode from UNI's own rows and leaves the page row out of a plan", async () => {
    requestMock.mockResolvedValue({ proposals: [] });
    mount([pageRow("ask"), row({ id: "p1", mode: "plan" }), row({ id: "p2", position: 2, mode: "plan" })]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Duyệt kế hoạch (2 bước)" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect((requestMock.mock.calls[0] as [string, { body: unknown }])[1].body).toEqual({ proposal_ids: ["p1", "p2"] });
  });

  it("leaves a waiting page row out of Áp dụng tất cả, whatever mode it was made in", async () => {
    requestMock.mockResolvedValue({ proposals: [] });
    mount([pageRow("plan"), row({ id: "p1" }), row({ id: "p2", position: 2 })]);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng tất cả" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect((requestMock.mock.calls[0] as [string, { body: unknown }])[1].body).toEqual({ proposal_ids: ["p1", "p2"] });
  });

  it("shows the rows as history, with no button or checkbox, while actions are off", () => {
    mount(
      [
        row({ id: "p1", mode: "plan" }),
        row({ id: "p2", position: 2, mode: "plan" }),
        row({ id: "p3", position: 3, mode: "plan", status: "applied", can_undo: true, result: { object_id: "T1", href: "/acme/team/tasks/T1", revision: 2, changes: [], note: "" } }),
      ],
      true,
    );
    expect(screen.getAllByText("Viết spec")).toHaveLength(3);
    expect(screen.getByText("Đã áp dụng")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Mở" })).toHaveAttribute("href", "/acme/team/tasks/T1");
  });

  it("links the object an update names when its outcome is unknown", () => {
    mount([row({ status: "unknown" })]);
    expect(screen.getByRole("link", { name: "Mở" })).toHaveAttribute("href", "/acme/team/tasks/T1");
  });

  it("disables every row while one call is in flight", () => {
    requestMock.mockReturnValue(new Promise(() => undefined));
    mount([row({ id: "p1" }), row({ id: "p2", position: 2 })]);
    fireEvent.click(screen.getAllByRole("button", { name: "Áp dụng" })[0]!);
    screen.getAllByRole("button", { name: "Áp dụng" }).forEach((b) => expect(b).toBeDisabled());
    expect(screen.getByRole("button", { name: "Áp dụng tất cả" })).toBeDisabled();
  });
});

