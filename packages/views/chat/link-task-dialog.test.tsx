import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@uniwork/core/api";
import { requestMock, wrap } from "../test/api-mock";
import { LinkTaskDialog } from "./link-task-dialog";

const state = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@uniwork/core/chat", () => ({
  useLinkChatMessage: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}));

const task = (i: number) => ({
  id: `t${i}`,
  workspace_id: "ws1",
  identifier: `LUN-${i}`,
  title: `Việc ${i}`,
  description: "",
  created_by: "u1",
  status: "todo",
  priority: "medium",
  position: i,
  revision: 1,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
});

/** One rows page as the table API answers it. */
const page = (ids: number[], total = ids.length) => ({
  query_fingerprint: "f",
  group_key: null,
  parent_id: null,
  total,
  rows: ids.map((i) => ({ task: task(i), direct_child_count: 0, labels: [] })),
  next_cursor: null,
});

type Body = { query?: { search?: string }; limit?: number };

/** The server's search: title or identifier contains the words. */
function answerRows(all: number[], total?: number) {
  requestMock.mockImplementation((path: string, init?: { body?: Body }) => {
    if (!path.endsWith("/tasks/table/rows")) return Promise.resolve({});
    const q = init?.body?.query?.search?.toLowerCase() ?? "";
    const hits = all.filter((i) => !q || `việc ${i} lun-${i}`.includes(q));
    return Promise.resolve(page(hits.slice(0, init?.body?.limit ?? 40), total ?? hits.length));
  });
}

const dialog = <LinkTaskDialog open onOpenChange={vi.fn()} workspaceId="ws1" messageId="m1" />;

const emptyText = () => document.querySelector("[cmdk-empty]")?.textContent ?? "";

describe("LinkTaskDialog", () => {
  beforeEach(() => {
    requestMock.mockReset();
    state.mutateAsync.mockReset();
  });

  it("shows a skeleton while tasks load", () => {
    requestMock.mockReturnValue(new Promise(() => undefined));
    render(wrap(dialog));
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("searches on the server, not by pulling every task into the browser", async () => {
    answerRows([0, 1, 2]);
    render(wrap(dialog));
    expect(await screen.findAllByRole("option")).toHaveLength(3);
    const first = requestMock.mock.calls[0] as [string, { body: Body }];
    expect(first[0]).toBe("/api/v1/workspaces/ws1/tasks/table/rows");
    expect(first[1].body.limit).toBe(40);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "LUN-2" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    const last = requestMock.mock.calls.at(-1) as [string, { body: Body }];
    expect(last[1].body.query?.search).toBe("LUN-2");
  });

  it("says when the server has more than it sent", async () => {
    answerRows(Array.from({ length: 45 }, (_, i) => i));
    render(wrap(dialog));
    expect(await screen.findAllByRole("option")).toHaveLength(40);
    expect(screen.getByText(/40/)).toBeInTheDocument();
  });

  it("tells an empty workspace apart from no match", async () => {
    answerRows([]);
    const { unmount } = render(wrap(dialog));
    await waitFor(() => expect(emptyText()).not.toBe(""));
    const noTasks = emptyText();
    unmount();
    answerRows([0, 1, 2]);
    render(wrap(dialog));
    await screen.findAllByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    const noMatch = emptyText();
    expect(noMatch).not.toBe("");
    expect(noMatch).not.toBe(noTasks);
  });

  it("marks the picked task with a visible check and in its name, not with aria-checked", async () => {
    answerRows([0, 1]);
    render(wrap(dialog));
    const options = await screen.findAllByRole("option");
    fireEvent.click(options[1]!);
    const picked = screen.getByRole("option", { name: /Việc 1, đã chọn/ });
    expect(picked).not.toHaveAttribute("aria-checked");
    expect(screen.getByText(/Đã chọn: Việc 1/)).toBeInTheDocument();
  });

  it("shows a localized error when linking fails, never the server's sentence", async () => {
    answerRows([0, 1]);
    state.mutateAsync.mockRejectedValue(new ApiError("forbidden: raw server text", "forbidden", 403));
    render(wrap(dialog));
    fireEvent.click((await screen.findAllByRole("option"))[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Gắn" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bạn không có quyền làm việc này.");
    expect(alert).not.toHaveTextContent("raw server text");
    expect(state.mutateAsync).toHaveBeenCalledWith({
      messageId: "m1",
      target_type: "task",
      target_id: "t1",
    });
  });
});
