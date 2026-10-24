import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext, type DetailContextValue } from "../detail-context";
import { demo, demoUser, demoWorkspace, detailValue, type DemoUserKey } from "../test-fixtures";
import { MinutesTab } from "./minutes-tab";

const M1 = demo.meetings.m1.meeting.id;
const BASE = `/api/v1/meetings/${M1}`;
const LAN = demo.users.lan.id;
const decision = demo.meetings.m1.summary.summary.decisions[1]!;

const draft = { document_id: "d1", finalized: false, edited_since_finalized: false, can_edit: true, pending_items: 9 };
const finalized = {
  ...draft,
  finalized: true,
  finalized_at: "2026-10-22T03:00:00Z",
  finalized_by: LAN,
  finalized_version_id: "v2",
  finalized_version: 2,
};

const text = (s: string) => ({ type: "text", text: s });
const para = (s: string) => ({ type: "paragraph", content: [text(s)] });
const bullets = (...items: string[]) => ({
  type: "bulletList",
  content: items.map((s) => ({ type: "listItem", content: [para(s)] })),
});
const heading = (level: number, s: string) => ({ type: "heading", attrs: { level }, content: [text(s)] });
const cell = (type: string, s: string) => ({ type, content: [para(s)] });

/** The page as the server writes it (meeting_minutes_render.go), cut to one of each block. */
const page = {
  id: "d1",
  organization_id: demo.org.id,
  workspace_id: demo.workspace.id,
  kind: "page",
  title: "Biên bản: Giao ban tuần 43 (22/10/2026)",
  visibility: "workspace",
  revision: "1",
  current_version: 0,
  position: 0,
  my_level: "manage",
  created_by: demo.users.ha.id,
  updated_by: demo.users.ha.id,
  created_at: "2026-10-23T07:12:37Z",
  updated_at: "2026-10-23T07:12:37Z",
  content: {
    type: "doc",
    content: [
      bullets("Thời gian: 09:00 – 09:28 (GMT+7), 22/10/2026", "Chủ trì: Lan Phạm", "Thư ký: Hà Vũ"),
      heading(2, "Thành phần"),
      para("Có mặt 3/3 thành viên (100%)."),
      bullets("Có mặt: Lan Phạm, Hà Vũ, Minh Trần"),
      heading(2, "Nội dung"),
      para("Buổi giao ban tuần 43 có đủ 3/3 thành viên."),
      heading(3, "Rà soát việc tồn tuần trước (lúc 09:01)"),
      bullets("Hợp đồng giữ chỗ khách sạn Riverside đã ký."),
      heading(2, "Kết luận"),
      {
        type: "orderedList",
        content: [
          { type: "listItem", content: [para(`${decision.text} (lúc 09:06, 09:07)`)] },
          { type: "listItem", content: [para("Đưa bộ phát 4G dự phòng vào danh sách thiết bị. (lúc 09:13)")] },
        ],
      },
      heading(2, "Việc đã giao"),
      {
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader", "Việc"), cell("tableHeader", "Người phụ trách"), cell("tableHeader", "Hạn")] },
          { type: "tableRow", content: [cell("tableCell", "Gửi báo giá"), cell("tableCell", "Minh Trần"), cell("tableCell", "26/10/2026")] },
        ],
      },
      para("Người lập: Hà Vũ · Ngày lập: 23/10/2026"),
    ],
  },
};

/** GET minutes answers the current state; each POST command moves it to what `after` names. */
function respond(minutes: unknown, after: Record<string, unknown> = {}) {
  let current = minutes;
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (init?.method === "POST") {
      const command = p.split("/minutes")[1]?.replace("/", "") || "create";
      current = after[command] ?? null;
      return Promise.resolve({ minutes: current });
    }
    if (p === `${BASE}/minutes`) return Promise.resolve({ minutes: current });
    if (p === `${BASE}/summary`) return Promise.resolve(demo.meetings.m1.summary);
    if (p === "/api/v1/documents/d1") return Promise.resolve({ document: page });
    return Promise.resolve({});
  });
}

function withPostFailing(error: Error, path?: (p: string) => boolean) {
  const base = requestMock.getMockImplementation()!;
  requestMock.mockImplementation((p: unknown, init?: { method?: string }) =>
    init?.method === "POST" && (!path || path(String(p))) ? Promise.reject(error) : base(p, init),
  );
}

function renderTab({
  user = "lan",
  url = `/sao-mai/van-hanh/meetings/${M1}`,
  value,
}: { user?: DemoUserKey; url?: string; value?: Partial<DetailContextValue> } = {}) {
  setSessionUser(demoUser(user));
  const nav = fakeNav(url);
  const view = render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(user)}>
        <DetailContext.Provider value={detailValue("m1", { user, ...value })}>
          <MinutesTab />
        </DetailContext.Provider>
      </WorkspaceProvider>,
      nav,
    ),
  );
  return { ...view, nav };
}

function posted(): string[] {
  return requestMock.mock.calls
    .filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST")
    .map(([path]) => String(path));
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("MinutesTab", () => {
  it("says a failed make under its button, where it stays, not in a toast", async () => {
    respond(null);
    withPostFailing(new ApiError("x", "minutes_exist", 409));
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Lập biên bản" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cuộc họp đã có biên bản. Mở biên bản để sửa.");
  });

  it("lets a clerk make the minutes in the reader's language, then opens the page", async () => {
    respond(null, { create: draft });
    const { nav } = renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Lập biên bản" }));
    await waitFor(() => expect(posted()).toEqual([`${BASE}/minutes`]));
    const create = requestMock.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === "POST");
    expect((create?.[1] as { body?: unknown }).body).toEqual({ locale: "vi" });
    await waitFor(() => expect(nav.pathname).toBe("/sao-mai-mvkm79lj/van-hanh/documents/d1"));
  });

  it("offers no make to a member, and says the secretary is still on a draft", async () => {
    respond(null);
    const { unmount } = renderTab({ user: "minh" });
    expect(await screen.findByText("Chưa có biên bản.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lập biên bản" })).not.toBeInTheDocument();
    unmount();

    respond(draft);
    renderTab({ user: "minh", url: `/x?finalize=1` });
    expect(await screen.findByText("Thư ký đang hoàn thiện biên bản.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cập nhật từ tóm tắt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("says the minutes did not load and retries", async () => {
    respond(null);
    const base = requestMock.getMockImplementation()!;
    let fail = true;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      fail && String(path).endsWith("/minutes") ? Promise.reject(new ApiError("down", "forbidden", 403)) : base(path, init),
    );
    renderTab();
    expect(await screen.findByText("Không tải được biên bản.")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("button", { name: "Lập biên bản" })).toBeInTheDocument();
  });

  it("heads a draft with its state bar and quiet actions", async () => {
    respond(draft);
    renderTab();
    const heading = await screen.findByRole("heading", { level: 2, name: page.title });
    expect(heading).toHaveAttribute("id", "meeting-minutes-heading");
    expect(screen.getByText(/^Bản nháp · tạo từ tóm tắt \d\d:\d\d \d\d\/10 ·/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "9 việc chưa giao" })).toHaveAttribute(
      "href",
      `/sao-mai/van-hanh/meetings/${M1}?section=action-items`,
    );
    expect(screen.getByRole("link", { name: "Mở tài liệu" })).toHaveAttribute("href", "/sao-mai-mvkm79lj/van-hanh/documents/d1");
    expect(screen.getByRole("button", { name: "Cập nhật từ tóm tắt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bỏ chốt" })).not.toBeInTheDocument();
  });

  it("opens the confirm from ?finalize=1, warns about pending items and never blocks on them", async () => {
    respond(draft, { finalize: finalized });
    const { nav } = renderTab({ url: `/m?tab=minutes&finalize=1` });
    const dialog = await screen.findByRole("alertdialog", { name: "Chốt biên bản?" });
    expect(within(dialog).getByText("Còn 9 việc chưa giao.")).toBeInTheDocument();
    expect(posted()).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Chốt biên bản" }));
    await waitFor(() => expect(posted()).toEqual([`${BASE}/minutes/finalize`]));
    expect(nav.searchParams.toString()).toBe("tab=minutes");
    expect(await screen.findByText(/^Biên bản đã chốt · Lan Phạm · bản 2$/)).toBeInTheDocument();
  });

  it("asks without a pending warning when nothing waits, and closing drops the param", async () => {
    respond({ ...draft, pending_items: 0 });
    const { nav } = renderTab({ url: `/m?finalize=1` });
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByText(/việc chưa giao/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("Sửa sau khi chốt sẽ tạo bản mới cần chốt lại.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(nav.searchParams.has("finalize")).toBe(false);
    expect(posted()).toEqual([]);
  });

  it("drops a failed finalize once the minutes another clerk finalized show up", async () => {
    respond(draft);
    const base = requestMock.getMockImplementation()!;
    let othersFinalized = false;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      if (init?.method === "POST") {
        othersFinalized = true;
        return Promise.reject(new ApiError("x", "conflict", 409));
      }
      if (othersFinalized && String(path).endsWith("/minutes")) return Promise.resolve({ minutes: finalized });
      return base(path, init);
    });
    renderTab({ url: "/m?finalize=1" });
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Chốt biên bản" }));
    expect(await screen.findByRole("button", { name: "Bỏ chốt" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows who finalized which version, the later edit with its re-finalize, and reopens", async () => {
    respond({ ...finalized, edited_since_finalized: true }, { finalize: { ...finalized, finalized_version: 3 }, reopen: draft });
    renderTab();
    expect(await screen.findByText("Biên bản đã chốt · Lan Phạm · bản 2")).toBeInTheDocument();
    expect(screen.getByText("Đã sửa sau khi chốt")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Xem bản đã chốt (phiên bản 2)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Chốt bản 3" }));
    await waitFor(() => expect(posted()).toEqual([`${BASE}/minutes/finalize`]));
    expect(await screen.findByText("Biên bản đã chốt · Lan Phạm · bản 3")).toBeInTheDocument();
    expect(screen.queryByText("Đã sửa sau khi chốt")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bỏ chốt" }));
    await waitFor(() => expect(posted()).toEqual([`${BASE}/minutes/finalize`, `${BASE}/minutes/reopen`]));
    expect(await screen.findByText(/^Bản nháp/)).toBeInTheDocument();
  });

  it("offers no finalized-version preview when the page is still as finalized", async () => {
    respond(finalized);
    renderTab();
    expect(await screen.findByRole("heading", { level: 2, name: page.title })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem bản đã chốt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cập nhật từ tóm tắt" })).not.toBeInTheDocument();
  });

  it("shows the version alone, not a former member, while members load", async () => {
    respond(finalized);
    const loading = { memberOf: () => undefined, members: [], loaded: false } as unknown as DetailContextValue["memberIndex"];
    renderTab({ value: { memberIndex: loading } });
    expect(await screen.findByText("Biên bản đã chốt · bản 2")).toBeInTheDocument();
    expect(screen.queryByText(/Thành viên đã rời/)).not.toBeInTheDocument();
  });

  it("names no page to a member it is closed to", async () => {
    respond({ ...finalized, document_id: null, finalized_version_id: null, finalized_version: null, can_edit: false });
    renderTab();
    expect(await screen.findByText("Bạn không có quyền xem UniNote biên bản.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mở tài liệu" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cần quyền chỉnh sửa UniNote biên bản để chốt hoặc bỏ chốt")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("keeps the commands from a clerk without edit on the page", async () => {
    respond({ ...finalized, can_edit: false });
    renderTab();
    expect(await screen.findByText("Cần quyền chỉnh sửa UniNote biên bản để chốt hoặc bỏ chốt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bỏ chốt" })).not.toBeInTheDocument();
  });

  it("refreshes the facts of draft minutes", async () => {
    respond(draft, { refresh: { ...draft, pending_items: 0 } });
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Cập nhật từ tóm tắt" }));
    await waitFor(() => expect(posted()).toEqual([`${BASE}/minutes/refresh`]));
    await waitFor(() => expect(screen.queryByText(/việc chưa giao/)).not.toBeInTheDocument());
  });

  it("says why a refresh was refused", async () => {
    respond(draft);
    withPostFailing(new ApiError("x", "minutes_finalized", 409));
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Cập nhật từ tóm tắt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Biên bản đã chốt");
  });

  it("says the page did not load and retries it", async () => {
    respond(draft);
    const base = requestMock.getMockImplementation()!;
    let fail = true;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      fail && String(path) === "/api/v1/documents/d1" ? Promise.reject(new Error("gone")) : base(path, init),
    );
    renderTab();
    expect(await screen.findByText("Không tải được nội dung biên bản.")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("article", { name: "Nội dung biên bản" })).toBeInTheDocument();
  });

  it("previews the page: properties, sections, time rows, the table and the closing line", async () => {
    respond(draft);
    const set = vi.fn();
    renderTab({ value: { tabs: { list: ["overview", "transcript", "minutes"], current: "minutes", set } } });
    const doc = await screen.findByRole("article", { name: "Nội dung biên bản" });
    // The opening list becomes a properties grid.
    expect(within(doc).getByText("Chủ trì").tagName).toBe("DT");
    expect(within(doc).getByText("Lan Phạm").closest("dd")).not.toBeNull();
    expect(within(doc).getByRole("heading", { level: 3, name: "Kết luận" })).toBeInTheDocument();
    // AI prose is muted while the minutes are a draft; facts are not.
    expect(within(doc).getByText("Buổi giao ban tuần 43 có đủ 3/3 thành viên.").closest("p")).toHaveClass("text-muted-foreground");
    expect(within(doc).getByText("Có mặt 3/3 thành viên (100%).").closest("p")).not.toHaveClass("text-muted-foreground");
    // A topic's time opens the transcript; the time suffix leaves the text.
    expect(within(doc).getByRole("heading", { level: 4, name: /Rà soát việc tồn tuần trước$/ })).toBeInTheDocument();
    await userEvent.click(within(doc).getByRole("button", { name: "Xem căn cứ lúc 09:01" }));
    expect(set).toHaveBeenCalledWith("transcript");
    // A decision the summary knows carries its evidence count; another, the page's own times.
    const row = within(doc).getByText(decision.text).closest("li")!;
    expect(row).toHaveTextContent(`+${decision.evidence.length - 1}`);
    expect(within(doc).getByText("Đưa bộ phát 4G dự phòng vào danh sách thiết bị.")).toBeInTheDocument();
    expect(within(doc).getByRole("columnheader", { name: "Hạn" })).toBeInTheDocument();
    expect(within(doc).getByRole("cell", { name: "Minh Trần" })).toBeInTheDocument();
    expect(within(doc).getByRole("cell", { name: "26/10/2026" })).toHaveAttribute("data-label", "Hạn");
    expect(within(doc).getByText("Người lập: Hà Vũ · Ngày lập: 23/10/2026").closest("p")).toHaveClass("border-t");
  });

  it("sets the AI prose in foreground ink once finalized, and keeps page times plain without a transcript", async () => {
    respond(finalized);
    renderTab({ value: { tabs: { list: ["overview", "minutes"], current: "minutes", set: () => {} } } });
    const doc = await screen.findByRole("article");
    expect(within(doc).getByText("Buổi giao ban tuần 43 có đủ 3/3 thành viên.").closest("p")).not.toHaveClass("text-muted-foreground");
    expect(within(doc).queryByRole("button", { name: "Xem căn cứ lúc 09:01" })).not.toBeInTheDocument();
    expect(within(doc).getByText("09:01").tagName).toBe("TIME");
  });

  it("tells an outsider only whether the minutes are final", async () => {
    respond(draft);
    setSessionUser(demoUser("tuan"));
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={demoWorkspace} user={demoUser("tuan")}>
          <DetailContext.Provider value={detailValue("m1Outsider")}>
            <MinutesTab />
          </DetailContext.Provider>
        </WorkspaceProvider>,
      ),
    );
    expect(await screen.findByText("Biên bản chưa chốt.")).toBeInTheDocument();
    expect(requestMock.mock.calls.map(([p]) => String(p))).not.toContain("/api/v1/documents/d1");
  });
});
