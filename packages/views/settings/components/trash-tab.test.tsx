import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrap } from "../../test/api-mock";
import { TrashTab } from "./trash-tab";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const user: User = {
  id: "u1",
  email: "an@x.com",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};
const members = [
  { workspace_id: "ws1", user_id: "u1", email: "an@x.com", display_name: "An", role: "admin" },
  { workspace_id: "ws1", user_id: "u2", email: "lan@x.com", display_name: "Lan", role: "member" },
  { workspace_id: "ws1", user_id: "u3", email: "binh@x.com", display_name: "Bình", role: "member" },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const taskRow = (over: Record<string, unknown> = {}) => ({
  kind: "task",
  id: "t1",
  title: "Thử thùng rác cha",
  identifier: "DOI-5",
  count: 1,
  location_title: "Website mới",
  location_path: [],
  trashed_by: "u2",
  trashed_at: iso(-2 * 60_000),
  purge_after: iso(30 * DAY - HOUR),
  can_manage: true,
  ...over,
});
const projectRow = (over: Record<string, unknown> = {}) => ({
  kind: "project",
  id: "p1",
  title: "Dự án thử",
  count: 1,
  location_title: "Team",
  location_path: [],
  trashed_by: "u1",
  trashed_at: iso(-DAY),
  purge_after: iso(29 * DAY - HOUR),
  can_manage: true,
  ...over,
});
const documentRow = (over: Record<string, unknown> = {}) => ({
  kind: "document",
  id: "d1",
  title: "Hợp đồng mẫu",
  sub_kind: "file",
  count: 0,
  location_title: "Team",
  location_path: ["Pháp lý", "Mẫu"],
  trashed_by: "u3",
  trashed_at: iso(-25 * DAY),
  purge_after: iso(5 * DAY - HOUR),
  can_manage: true,
  ...over,
});

type Init = { method?: string } | undefined;
/** The trash list the server answers for a GET of the trash route. */
let listFor: (url: string) => { items: unknown[]; next_cursor: string };
let post: (path: string) => Promise<unknown>;

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
  requestMock.mockReset();
  listFor = () => ({ items: [taskRow(), projectRow(), documentRow()], next_cursor: "" });
  post = () => Promise.resolve({ trash_batch_id: "b1", ids: ["t1"] });
  requestMock.mockImplementation((path: unknown, init?: Init) => {
    const p = String(path);
    if (init?.method === "POST") return post(p);
    if (p.endsWith("/members")) return Promise.resolve({ members });
    if (p.includes("/trash")) return Promise.resolve(listFor(p));
    return Promise.resolve({});
  });
});

function renderTab({ documents = true }: { documents?: boolean } = {}) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: documents } }));
  return render(
    wrap(
      <FeatureFlagsProvider service={service}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <TrashTab />
        </WorkspaceProvider>
      </FeatureFlagsProvider>,
    ),
  );
}

const trashGets = () =>
  requestMock.mock.calls
    .filter(([path, init]) => String(path).includes("/trash") && (init as Init)?.method !== "POST")
    .map(([path]) => String(path));
const posts = () =>
  requestMock.mock.calls.filter(([, init]) => (init as Init)?.method === "POST").map(([path]) => String(path));
const rowOf = (title: string) => screen.getByText(title).closest("tr") as HTMLElement;

async function pick(comboboxName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

async function openRowMenu(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Thao tác cho ${title}` }));
  return screen.findByRole("menu");
}

describe("TrashTab", () => {
  it("heads the tab and lists the three kinds with their location, deleter and days left", async () => {
    renderTab();
    expect(screen.getByRole("heading", { level: 2, name: "Thùng rác" })).toBeInTheDocument();
    expect(screen.getByText("Mục đã xóa nằm ở đây 30 ngày, sau đó tự xóa vĩnh viễn.")).toBeInTheDocument();
    expect(await screen.findByText("Thử thùng rác cha")).toBeInTheDocument();

    const task = rowOf("Thử thùng rác cha");
    expect(within(task).getByText("DOI-5")).toBeInTheDocument();
    expect(within(task).getByText("Công việc · kèm 1 việc con")).toBeInTheDocument();
    expect(within(task).getByText("Website mới")).toBeInTheDocument();
    await waitFor(() => expect(within(task).getByText("Lan")).toBeInTheDocument());
    expect(within(task).getByText("30 ngày")).not.toHaveClass("text-destructive");

    const project = rowOf("Dự án thử");
    expect(within(project).getByText("Dự án · 1 công việc sẽ gắn lại khi khôi phục")).toBeInTheDocument();
    expect(within(project).getByText("Team")).toBeInTheDocument();
    expect(within(project).getByText("An")).toBeInTheDocument();

    const doc = rowOf("Hợp đồng mẫu");
    expect(within(doc).getByText("Tệp")).toBeInTheDocument();
    expect(within(doc).getByText("Pháp lý › Mẫu")).toBeInTheDocument();
    expect(within(doc).getByText("Bình")).toBeInTheDocument();
    expect(within(doc).getByText("5 ngày")).toHaveClass("text-destructive");
    expect(trashGets()[0]).toBe("/api/v1/workspaces/ws1/trash");
  });

  it("says only the kind when nothing comes along, and the workspace for a document at the root", async () => {
    listFor = () => ({
      items: [taskRow({ count: 0 }), projectRow({ count: 0 }), documentRow({ sub_kind: "folder", location_path: [] })],
      next_cursor: "",
    });
    renderTab();
    await screen.findByText("Thử thùng rác cha");
    expect(within(rowOf("Thử thùng rác cha")).getByText("Công việc")).toBeInTheDocument();
    expect(within(rowOf("Dự án thử")).getByText("Dự án")).toBeInTheDocument();
    const doc = rowOf("Hợp đồng mẫu");
    expect(within(doc).getByText("Thư mục")).toBeInTheDocument();
    expect(within(doc).getByText("Team")).toBeInTheDocument();
  });

  it("asks the server again from page one when the kind changes", async () => {
    renderTab();
    await screen.findByText("Thử thùng rác cha");
    await pick("Loại", "Dự án");
    await waitFor(() => expect(trashGets()).toContain("/api/v1/workspaces/ws1/trash?kind=project"));
    expect(trashGets().some((url) => url.includes("cursor"))).toBe(false);
  });

  it("filters by who deleted, with Tôi as the current person", async () => {
    renderTab();
    await screen.findByText("Thử thùng rác cha");
    await pick("Người xóa", "Tôi");
    await waitFor(() => expect(trashGets()).toContain("/api/v1/workspaces/ws1/trash?trashed_by=u1"));
  });

  it("says nothing matches a filter and clears it on Bỏ lọc", async () => {
    listFor = (url) => (url.includes("q=") ? { items: [], next_cursor: "" } : { items: [taskRow()], next_cursor: "" });
    renderTab();
    await screen.findByText("Thử thùng rác cha");
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm theo tên…" }), { target: { value: "zzz" } });
    expect(await screen.findByText("Không có mục nào khớp")).toBeInTheDocument();
    expect(trashGets()).toContain("/api/v1/workspaces/ws1/trash?q=zzz");
    const before = trashGets().length;
    fireEvent.click(screen.getByRole("button", { name: "Bỏ lọc" }));
    expect(await screen.findByText("Thử thùng rác cha")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Tìm theo tên…" })).toHaveValue("");
    expect(trashGets().slice(before).every((url) => url === "/api/v1/workspaces/ws1/trash")).toBe(true);
  });

  it("says the trash is empty when it is", async () => {
    listFor = () => ({ items: [], next_cursor: "" });
    renderTab();
    expect(await screen.findByText("Thùng rác trống")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bỏ lọc" })).not.toBeInTheDocument();
  });

  it("locks restore and delete forever on a project the reader may not manage, and says why", async () => {
    listFor = () => ({ items: [projectRow({ can_manage: false })], next_cursor: "" });
    renderTab();
    const menu = await openRowMenu("Dự án thử");
    expect(within(menu).getByRole("menuitem", { name: "Khôi phục" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Xóa vĩnh viễn" })).toHaveAttribute("aria-disabled", "true");
    expect(menu).toHaveTextContent(
      "Chỉ người tạo, người phụ trách hoặc quản trị viên mới khôi phục hay xóa vĩnh viễn được dự án này.",
    );
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    expect(posts()).toEqual([]);
  });

  it("says a locked document needs its manage permission", async () => {
    listFor = () => ({ items: [documentRow({ can_manage: false })], next_cursor: "" });
    renderTab();
    const menu = await openRowMenu("Hợp đồng mẫu");
    expect(menu).toHaveTextContent("Cần quyền quản lý tài liệu này.");
  });

  it("restores a task through its own route, and the row leaves the list", async () => {
    let restored = false;
    post = () => {
      restored = true;
      return Promise.resolve({ trash_batch_id: "b1", ids: ["t1"] });
    };
    listFor = () => ({ items: restored ? [projectRow()] : [taskRow(), projectRow()], next_cursor: "" });
    renderTab();
    const menu = await openRowMenu("Thử thùng rác cha");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã khôi phục"));
    expect(posts()).toEqual(["/api/v1/tasks/t1/restore"]);
    await waitFor(() => expect(screen.queryByText("Thử thùng rác cha")).not.toBeInTheDocument());
    expect(screen.getByText("Dự án thử")).toBeInTheDocument();
  });

  it("explains a project whose title is taken again", async () => {
    post = () => Promise.reject(new ApiError("x", "duplicate_project_title", 409));
    renderTab();
    const menu = await openRowMenu("Dự án thử");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Đã có dự án trùng tên")));
    expect(posts()).toEqual(["/api/v1/workspaces/ws1/projects/p1/restore"]);
  });

  it("deletes a document forever only after the dialog", async () => {
    post = () => Promise.resolve({});
    renderTab();
    const menu = await openRowMenu("Hợp đồng mẫu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Xóa vĩnh viễn" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Không hoàn tác được/)).toBeInTheDocument();
    expect(posts()).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã xóa vĩnh viễn"));
    expect(posts()).toEqual(["/api/v1/documents/d1/purge"]);
  });

  it("loads the next page on demand", async () => {
    listFor = (url) =>
      url.includes("cursor=c2")
        ? { items: [taskRow({ id: "t9", title: "Việc cũ hơn" })], next_cursor: "" }
        : { items: [taskRow()], next_cursor: "c2" };
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Tải thêm" }));
    expect(await screen.findByText("Việc cũ hơn")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải thêm" })).not.toBeInTheDocument();
  });

  it("offers Tài liệu in the kind filter only while documents are on", async () => {
    const { unmount } = renderTab();
    await screen.findByText("Thử thùng rác cha");
    fireEvent.click(screen.getByRole("combobox", { name: "Loại" }));
    expect(await screen.findByRole("option", { name: "Tài liệu" })).toBeInTheDocument();
    unmount();

    renderTab({ documents: false });
    await screen.findByText("Thử thùng rác cha");
    fireEvent.click(screen.getByRole("combobox", { name: "Loại" }));
    expect(await screen.findByRole("option", { name: "Dự án" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Tài liệu" })).not.toBeInTheDocument();
  });
});
