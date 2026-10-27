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

type Init = { method?: string; headers?: Record<string, string> } | undefined;
/** The trash list the server answers for a GET of the trash route. */
let listFor: (url: string) => { items: unknown[]; next_cursor: string };
let post: (path: string) => Promise<unknown>;

/** A verifiable restore answer for one document, restored to the workspace root. */
const archive = (id: string, title: string, kind = "folder") => ({
  document: {
    id,
    organization_id: "o1",
    workspace_id: "ws1",
    kind,
    title,
    visibility: "workspace",
    revision: "2",
    current_version: 0,
    position: 0,
    parent_id: null,
    created_by: "u1",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "2026-09-27T09:00:00Z",
    updated_at: "2026-10-26T09:00:00Z",
  },
  batch_id: "b1",
  affected: [id],
});

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

/** Ticks one kind in the Loại list; the list stays open for the next pick. */
async function pickKind(name: string) {
  if (!screen.queryByRole("menu")) fireEvent.click(screen.getByRole("button", { name: /^Loại/ }));
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name }));
}

/** Ticks one person in the Người xóa list. */
async function pickPerson(name: string) {
  if (!screen.queryByRole("dialog")) fireEvent.click(screen.getByRole("button", { name: /^Người xóa/ }));
  fireEvent.click(await screen.findByRole("checkbox", { name }));
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

  it("picks several kinds, asks again from page one even after Tải thêm, and names them on the chip", async () => {
    listFor = (url) =>
      url.includes("cursor=c2")
        ? { items: [taskRow({ id: "t9", title: "Việc cũ hơn" })], next_cursor: "" }
        : { items: [taskRow()], next_cursor: url.includes("kind=") ? "" : "c2" };
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Tải thêm" }));
    expect(await screen.findByText("Việc cũ hơn")).toBeInTheDocument();
    expect(trashGets()).toContain("/api/v1/workspaces/ws1/trash?cursor=c2");
    expect(screen.queryByRole("button", { name: "Bỏ lọc Loại" })).not.toBeInTheDocument();
    await pickKind("Công việc");
    await pickKind("Dự án");
    await waitFor(() => expect(trashGets()).toContain("/api/v1/workspaces/ws1/trash?kind=task&kind=project"));
    expect(trashGets().filter((url) => url.includes("kind=")).every((url) => !url.includes("cursor"))).toBe(true);
    const chip = screen.getByRole("button", { name: "Loại: Công việc, Dự án" });
    expect(chip).toHaveTextContent("Công việc, Dự án");
    expect(chip).toHaveAttribute("title", "Công việc, Dự án");
    // Every row ends in a box, ticked only when picked, like the people list.
    for (const [name, on] of [["Công việc", true], ["Dự án", true], ["Tài liệu", false]] as const) {
      const row = screen.getByRole("menuitemcheckbox", { name });
      expect(row).toHaveAttribute("aria-checked", String(on));
      const box = row.lastElementChild as HTMLElement;
      expect(box).toHaveAttribute("data-slot", "trash-filter-check");
      expect(box.hasAttribute("data-checked")).toBe(on);
    }
  });

  it("clears a kind filter from the × on its chip without opening the list", async () => {
    renderTab();
    await screen.findByText("Thử thùng rác cha");
    await pickKind("Dự án");
    await waitFor(() => expect(trashGets()).toContain("/api/v1/workspaces/ws1/trash?kind=project"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    const before = trashGets().length;
    fireEvent.click(screen.getByRole("button", { name: "Bỏ lọc Loại" }));
    await waitFor(() => expect(trashGets().length).toBeGreaterThan(before));
    expect(trashGets().slice(before).every((url) => url === "/api/v1/workspaces/ws1/trash")).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Loại" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Bỏ lọc Loại" })).not.toBeInTheDocument();
  });

  it("filters by several deleters, Tôi first, then the others by name, searchable", async () => {
    renderTab();
    await screen.findByText("Thử thùng rác cha");
    fireEvent.click(screen.getByRole("button", { name: "Người xóa" }));
    const list = await screen.findByRole("dialog");
    const boxes = within(list).getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    ["Tôi", "Bình", "Lan"].forEach((name, i) => {
      expect(boxes[i]).toHaveAccessibleName(name);
      // The box comes after the name, on the right as in the Loại list.
      const text = within(boxes[i]!.closest("label")!).getByText(name);
      expect(text.compareDocumentPosition(boxes[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    fireEvent.change(within(list).getByRole("searchbox", { name: "Tìm người" }), { target: { value: "binh" } });
    await waitFor(() => expect(within(list).queryByRole("checkbox", { name: "Lan" })).not.toBeInTheDocument());
    await pickPerson("Bình");
    fireEvent.change(within(list).getByRole("searchbox", { name: "Tìm người" }), { target: { value: "" } });
    await pickPerson("Tôi");
    await waitFor(() => expect(trashGets()).toContain("/api/v1/workspaces/ws1/trash?trashed_by=u1&trashed_by=u3"));
    expect(screen.getByRole("button", { name: "Người xóa: Tôi, Bình" })).toBeInTheDocument();

    const before = trashGets().length;
    fireEvent.click(screen.getByRole("button", { name: "Bỏ lọc Người xóa" }));
    await waitFor(() => expect(trashGets().length).toBeGreaterThan(before));
    expect(trashGets().slice(before).every((url) => url === "/api/v1/workspaces/ws1/trash")).toBe(true);
  });

  it("clears the search from its own × and puts the cursor back in the box", async () => {
    renderTab();
    await screen.findByText("Thử thùng rác cha");
    const box = screen.getByRole("searchbox", { name: "Tìm theo tên…" });
    expect(screen.queryByRole("button", { name: "Xóa tìm kiếm" })).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "zzz" } });
    await waitFor(() => expect(trashGets()).toContain("/api/v1/workspaces/ws1/trash?q=zzz"));
    const before = trashGets().length;
    const clear = screen.getByRole("button", { name: "Xóa tìm kiếm" });
    // jsdom cannot press: a translate-centred × jumps off the pointer when the
    // Button's press shift replaces its translate, and the click never lands.
    expect(clear.className).not.toMatch(/-translate-[xy]/);
    fireEvent.click(clear);
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Xóa tìm kiếm" })).not.toBeInTheDocument();
    await waitFor(() => expect(trashGets().length).toBeGreaterThan(before));
    expect(trashGets().slice(before).every((url) => url === "/api/v1/workspaces/ws1/trash")).toBe(true);
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
    const why = "Chỉ người tạo, người phụ trách hoặc quản trị viên mới khôi phục hay xóa vĩnh viễn được dự án này.";
    for (const name of ["Khôi phục", "Xóa vĩnh viễn"]) {
      const item = within(menu).getByRole("menuitem", { name });
      expect(item).toHaveAttribute("aria-disabled", "true");
      // The reason is read with the item, not only seen beside it.
      expect(item).toHaveAccessibleDescription(why);
    }
    expect(menu).toHaveTextContent(why);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    expect(posts()).toEqual([]);
  });

  it("says a locked document needs its manage permission", async () => {
    listFor = () => ({ items: [documentRow({ can_manage: false })], next_cursor: "" });
    renderTab();
    const menu = await openRowMenu("Hợp đồng mẫu");
    expect(within(menu).getByRole("menuitem", { name: "Khôi phục" })).toHaveAccessibleDescription(
      "Cần quyền quản lý tài liệu này.",
    );
  });

  it("names a row without a title as untitled, in the cell and the menu", async () => {
    listFor = () => ({ items: [taskRow({ title: "" }), documentRow({ title: "" })], next_cursor: "" });
    renderTab();
    expect(await screen.findAllByRole("button", { name: "Thao tác cho Chưa có tiêu đề" })).toHaveLength(2);
    expect(screen.getAllByText("Chưa có tiêu đề")).toHaveLength(2);
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

  it("explains a task batch too large to restore at once", async () => {
    post = () => Promise.reject(new ApiError("x", "trash_too_large", 422));
    renderTab();
    const menu = await openRowMenu("Thử thùng rác cha");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Có quá nhiều task")));
  });

  it("rereads the list when the task is already gone", async () => {
    post = () => Promise.reject(new ApiError("x", "not_found", 404));
    renderTab();
    const menu = await openRowMenu("Thử thùng rác cha");
    const before = trashGets().length;
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nội dung này không còn tồn tại hoặc đã bị xóa."));
    await waitFor(() => expect(trashGets().length).toBeGreaterThan(before));
  });

  it("words a document no longer in the trash as the Documents trash does, and rereads the list", async () => {
    post = () => Promise.reject(new ApiError("x", "document_not_in_trash", 409));
    renderTab();
    const menu = await openRowMenu("Hợp đồng mẫu");
    const before = trashGets().length;
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Mục này không còn trong thùng rác."));
    await waitFor(() => expect(trashGets().length).toBeGreaterThan(before));
  });

  it("restores a folder with an idempotency key and says when listed children stayed behind", async () => {
    listFor = () => ({
      items: [
        documentRow({ id: "f1", title: "Hồ sơ", sub_kind: "folder", location_path: [] }),
        documentRow({ id: "d2", title: "Mẫu riêng", parent_id: "f1", can_manage: false }),
      ],
      next_cursor: "",
    });
    post = () => Promise.resolve(archive("f1", "Hồ sơ"));
    renderTab();
    const menu = await openRowMenu("Hồ sơ");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Đã khôi phục Hồ sơ về gốc workspace", {
        description: "Một số mục con vẫn ở lại thùng rác.",
      }),
    );
    const [, init] = requestMock.mock.calls.find(([path]) => String(path) === "/api/v1/documents/f1/restore")!;
    expect((init as Init)?.headers?.["Idempotency-Key"]).toBeTruthy();
  });

  it("explains a project whose title is taken again", async () => {
    post = () => Promise.reject(new ApiError("x", "duplicate_project_title", 409));
    renderTab();
    const menu = await openRowMenu("Dự án thử");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Khôi phục" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Đã có dự án trùng tên")));
    expect(posts()).toEqual(["/api/v1/workspaces/ws1/projects/p1/restore"]);
  });

  it("deletes a task forever only after the dialog", async () => {
    post = () => Promise.resolve({});
    renderTab();
    const menu = await openRowMenu("Thử thùng rác cha");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Xóa vĩnh viễn" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Không hoàn tác được/)).toBeInTheDocument();
    expect(posts()).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã xóa vĩnh viễn"));
    expect(posts()).toEqual(["/api/v1/tasks/t1/purge"]);
  });

  it("deletes a document forever through the Documents trash dialog", async () => {
    post = () => Promise.resolve({});
    renderTab();
    const menu = await openRowMenu("Hợp đồng mẫu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Xóa vĩnh viễn" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Xóa vĩnh viễn Hợp đồng mẫu?" });
    expect(within(dialog).getByText("Mục này sẽ bị xóa vĩnh viễn và không thể hoàn tác.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã xóa vĩnh viễn Hợp đồng mẫu"));
    expect(posts()).toEqual(["/api/v1/documents/d1/purge"]);
  });

  it("warns that a folder's unmanaged children stay in the trash before purging it", async () => {
    listFor = () => ({ items: [documentRow({ sub_kind: "folder" })], next_cursor: "" });
    renderTab();
    const menu = await openRowMenu("Hợp đồng mẫu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Xóa vĩnh viễn" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Thư mục này sẽ bị xóa vĩnh viễn và không thể hoàn tác. Mục con bạn không quản lý vẫn ở lại thùng rác.",
      ),
    ).toBeInTheDocument();
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

  it("says so when the next page fails to load", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/members")) return Promise.resolve({ members });
      if (p.includes("cursor=c2")) return Promise.reject(new ApiError("x", "internal", 500));
      return Promise.resolve({ items: [taskRow()], next_cursor: "c2" });
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Tải thêm" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("Thử thùng rác cha")).toBeInTheDocument();
  });

  it("offers Tài liệu in the kind filter only while documents are on", async () => {
    const { unmount } = renderTab();
    await screen.findByText("Thử thùng rác cha");
    fireEvent.click(screen.getByRole("button", { name: "Loại" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "Tài liệu" })).toBeInTheDocument();
    unmount();

    renderTab({ documents: false });
    await screen.findByText("Thử thùng rác cha");
    fireEvent.click(screen.getByRole("button", { name: "Loại" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "Dự án" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Tài liệu" })).not.toBeInTheDocument();
  });
});
