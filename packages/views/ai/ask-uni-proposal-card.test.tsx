import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AiProposalSchema, type AiProposal } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
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

function mount(proposals: AiProposal[], mode = "ask") {
  return render(wrapWithNav(<AskUniProposalCard message={{ id: "m1", proposals }} conversationId="c1" mode={mode} />));
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});

describe("AskUniProposalCard", () => {
  it("renders a pending ask card", () => {
    mount([row({ id: "p1" }), row({ id: "p2", position: 2 })]);
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
    mount([row({ id: "p1", mode: "plan" }), row({ id: "p2", position: 2, mode: "plan", preview: { target: { kind: "task", id: "", title: "Gửi" }, fields: [], refs: [1] } }), row({ id: "p3", position: 3, mode: "plan" })], "plan");
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
    expect(screen.getByRole("link", { name: "Mở" })).toHaveAttribute("href", "/acme/team/tasks/T1");
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
});

