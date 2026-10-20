import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { requestMock, wrap } from "../test/api-mock";
import { ChatDocumentPicker } from "./chat-document-picker";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";

const WS = "ws1";

function doc(id: string, title: string, over: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: WS,
    organization_id: "org1",
    kind: "file",
    title,
    revision: "1",
    current_version: 1,
    my_level: "manage",
    updated_at: "2026-10-20T03:00:00Z",
    ...over,
  };
}

/** What the library hands a sender: one row per way a document is, or is not, shareable. */
const RECENT = [
  doc("d-manage", "Kế hoạch Q4.docx"),
  doc("d-page", "Trang ghi chú", { kind: "page" }),
  doc("d-admin", "Báo cáo quản trị.xlsx", { my_level: "", admin_scope: true }),
  doc("d-edit", "Chỉ sửa được.docx", { my_level: "edit" }),
  doc("d-view", "Chỉ xem được.pdf", { my_level: "view" }),
  doc("d-folder", "Thư mục dự án", { kind: "folder" }),
  doc("d-myfolder", "My Folder", { kind: "folder", system_kind: "my_folder" }),
  doc("d-owned", "Biên bản của task.docx", { owner_kind: "work_product" }),
  doc("d-archived", "Bản cũ.docx", { archived_at: "2026-10-01T00:00:00Z" }),
  doc("d-shelved", "Cất đi.docx", { shelved_at: "2026-10-01T00:00:00Z" }),
];

const HIDDEN = [
  "Chỉ sửa được.docx",
  "Chỉ xem được.pdf",
  "Thư mục dự án",
  "My Folder",
  "Biên bản của task.docx",
  "Bản cũ.docx",
  "Cất đi.docx",
];

type Call = { path: string; init?: { method?: string; body?: unknown } };
const calls = (): Call[] =>
  requestMock.mock.calls.map(([path, init]) => ({ path: String(path), init: init as Call["init"] }));
const linkPosts = () =>
  calls().filter((c) => c.init?.method === "POST" && c.path.includes("/messages/document-link"));

function serve(over: { recent?: unknown[]; list?: unknown[]; link?: (c: Call) => unknown } = {}) {
  requestMock.mockImplementation((path: string, init?: Call["init"]) => {
    if (init?.method === "POST" && path.includes("/messages/document-link")) {
      return over.link
        ? Promise.resolve(over.link({ path, init }))
        : Promise.resolve({
            message: {
              id: "msg-new",
              room_id: "room1",
              workspace_id: WS,
              sender_id: "u1",
              sender_display_name: "An",
              kind: "document",
              body: "Kế hoạch Q4.docx",
              created_at: "2026-10-20T10:00:00Z",
              document: { document_id: "d-manage", viewer_level: "manage", viewer_can_manage: true },
            },
          });
    }
    if (path.includes("/documents/recent")) {
      return Promise.resolve({ documents: over.recent ?? RECENT, next_cursor: null });
    }
    if (path.includes("/documents?")) {
      return Promise.resolve({ documents: over.list ?? RECENT, next_cursor: null });
    }
    return Promise.resolve({});
  });
}

function renderPicker(over: Partial<React.ComponentProps<typeof ChatDocumentPicker>> = {}) {
  const props = { open: true, onOpenChange: vi.fn(), workspaceId: WS, roomId: "room1", ...over };
  render(wrap(<ChatDocumentPicker {...props} />));
  return props;
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockClear();
});

describe("ChatDocumentPicker list", () => {
  it("lists only what the sender can share: manage, admin_scope, and pages", async () => {
    serve();
    renderPicker();
    expect(await screen.findByText("Kế hoạch Q4.docx")).toBeInTheDocument();
    expect(screen.getByText("Trang ghi chú")).toBeInTheDocument();
    // The admin-scope row has no level at all, and still lists.
    expect(screen.getByText("Báo cáo quản trị.xlsx")).toBeInTheDocument();
    for (const title of HIDDEN) expect(screen.queryByText(title), title).not.toBeInTheDocument();
  });

  it("filters, never greys: no disabled row, no lock reason, no 'message the owner'", async () => {
    serve();
    renderPicker();
    await screen.findByText("Kế hoạch Q4.docx");
    const list = screen.getByRole("list", { name: "Tài liệu bạn có thể chia sẻ" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).not.toBeDisabled();
    expect(screen.queryByText(/Nhắn cho chủ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/không thể chia sẻ/i)).not.toBeInTheDocument();
  });

  it("opens on the recent documents and asks the workspace's recent route", async () => {
    serve();
    renderPicker();
    await screen.findByText("Kế hoạch Q4.docx");
    expect(calls().some((c) => c.path.startsWith(`/api/v1/workspaces/${WS}/documents/recent`))).toBe(true);
  });

  it("does not query anything while closed", () => {
    serve();
    renderPicker({ open: false });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("searches titles of documents after the typing settles", async () => {
    serve({ list: [doc("d-hit", "Hợp đồng thuê.docx")] });
    renderPicker();
    await screen.findByText("Kế hoạch Q4.docx");
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm tài liệu" }), { target: { value: "hợp đồng" } });
    expect(await screen.findByText("Hợp đồng thuê.docx")).toBeInTheDocument();
    expect(screen.queryByText("Kế hoạch Q4.docx")).not.toBeInTheDocument();
    const search = calls().find((c) => c.path.includes("/documents?"));
    const params = new URLSearchParams(search?.path.split("?")[1] ?? "");
    expect(params.get("q")).toBe("hợp đồng");
    expect(params.get("match")).toBe("title");
    expect(params.get("kind")).toBe("document");
  });

  it("filters a search result the same way", async () => {
    serve({ list: RECENT });
    renderPicker();
    await screen.findByText("Kế hoạch Q4.docx");
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm tài liệu" }), { target: { value: "a" } });
    await waitFor(() => expect(calls().some((c) => c.path.includes("/documents?"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("Chỉ sửa được.docx")).not.toBeInTheDocument());
    expect(screen.getByText("Kế hoạch Q4.docx")).toBeInTheDocument();
    for (const title of HIDDEN) expect(screen.queryByText(title), title).not.toBeInTheDocument();
  });
});

describe("ChatDocumentPicker states", () => {
  it("says no shareable document matches, truthfully, when the library has none for the sender", async () => {
    serve({ recent: [RECENT[3], RECENT[5]] });
    renderPicker();
    expect(await screen.findByText("Chưa có tài liệu nào để gửi")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tài liệu bạn có thể chia sẻ" })).not.toBeInTheDocument();
  });

  it("names the term in the empty state of a search", async () => {
    serve({ list: [] });
    renderPicker();
    await screen.findByText("Kế hoạch Q4.docx");
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm tài liệu" }), { target: { value: "xyz" } });
    expect(await screen.findByText(/Không có tài liệu nào bạn có thể chia sẻ khớp với "xyz"/)).toBeInTheDocument();
  });

  it("shows a spinner while the list loads", () => {
    requestMock.mockImplementation(() => new Promise(() => undefined));
    renderPicker();
    expect(screen.getByRole("status", { name: "Đang tải tài liệu…" })).toBeInTheDocument();
  });

  it("shows a retryable error when the list cannot load", async () => {
    requestMock.mockRejectedValue(new ApiError("boom", "internal", 500));
    renderPicker();
    expect(await screen.findByText("Không tải được danh sách tài liệu")).toBeInTheDocument();
    serve();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Kế hoạch Q4.docx")).toBeInTheDocument();
  });
});

describe("ChatDocumentPicker send", () => {
  async function choose(title: string) {
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
  }

  it("sends the chosen document at the default level, comment, then closes", async () => {
    serve();
    const onSent = vi.fn();
    const props = renderPicker({ onSent });
    await choose("Kế hoạch Q4.docx");
    // The share-level step shows the choice and the default.
    expect(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện")).toHaveTextContent("Nhận xét");
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(linkPosts()).toHaveLength(1));
    expect(linkPosts()[0]?.init?.body).toEqual({
      document_id: "d-manage",
      share_level: "comment",
      client_msg_id: expect.stringMatching(/\S/),
    });
    expect(linkPosts()[0]?.path).toBe(`/api/v1/workspaces/${WS}/chat/rooms/room1/messages/document-link`);
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("sends at the level the sender picked, and keeps the reply the composer holds", async () => {
    serve();
    renderPicker({ replyToId: "m-quoted" });
    await choose("Trang ghi chú");
    fireEvent.click(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Chỉnh sửa" }));
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(linkPosts()).toHaveLength(1));
    expect(linkPosts()[0]?.init?.body).toMatchObject({
      document_id: "d-page",
      share_level: "edit",
      reply_to_message_id: "m-quoted",
    });
  });

  it("offers no plain-file choice among the levels", async () => {
    serve();
    renderPicker();
    await choose("Kế hoạch Q4.docx");
    fireEvent.click(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện"));
    expect(await screen.findByRole("menuitemradio", { name: "Chỉ xem" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: "Chỉ gửi tệp" })).not.toBeInTheDocument();
  });

  it("goes back to the list from the level step without sending", async () => {
    serve();
    renderPicker();
    await choose("Kế hoạch Q4.docx");
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(await screen.findByText("Trang ghi chú")).toBeInTheDocument();
    expect(linkPosts()).toHaveLength(0);
  });

  it("toasts the failure, stays open, and retries under the same client_msg_id", async () => {
    let attempt = 0;
    serve({
      link: () => {
        attempt += 1;
        if (attempt === 1) throw new ApiError("too many", "share_batch_too_large", 422);
        return { message: undefined };
      },
    });
    // A throwing mock is a sync throw; make it a rejection like the transport.
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, init?: Call["init"]) => {
      try {
        return base(path, init);
      } catch (err) {
        return Promise.reject(err);
      }
    });
    const props = renderPicker();
    await choose("Kế hoạch Q4.docx");
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("quá nhiều người để chia sẻ tài liệu")),
    );
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(linkPosts()).toHaveLength(2));
    const ids = linkPosts().map((c) => (c.init?.body as { client_msg_id: string }).client_msg_id);
    expect(ids[0]).toBe(ids[1]);
  });

  it("falls back to its own copy for an error the chat table does not know", async () => {
    serve();
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, init?: Call["init"]) =>
      init?.method === "POST" ? Promise.reject(new ApiError("nope", "weird", 500)) : base(path, init),
    );
    renderPicker();
    await choose("Kế hoạch Q4.docx");
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không gửi được tài liệu. Thử lại."));
  });
});
