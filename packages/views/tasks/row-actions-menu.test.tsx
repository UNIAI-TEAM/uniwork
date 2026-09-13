import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task, User, Workspace } from "@uniwork/core/types";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { requestMock, wrap } from "../test/api-mock";
import { chooseInSubmenu, chooseItem, type Via } from "../test/menu-interactions";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { BoardView } from "./modes/board-view";
import { ListView } from "./modes/list-view";
import {
  TaskSurfaceActionsProvider,
  type TaskSurfaceActions,
} from "./surface/actions-context";

initI18n();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@uniwork/ui/lib/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("@uniwork/core/feature-flags", () => ({
  usePublicConfig: () => ({ data: undefined }),
}));

const sample: Task = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "w1",
  number: 1,
  identifier: "SAT-1",
  revision: 1,
  title: "Suite row",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_id: "u1",
  assignee_kind: "human",
  assignee: { kind: "human", id: "u1", display_name: "An Nguyễn" },
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

const user: User = {
  id: "u1",
  email: "an@example.com",
  display_name: "An Nguyễn",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function makeActions() {
  return {
    isPending: false,
    createTask: vi.fn<TaskSurfaceActions["createTask"]>(),
    updateTask: vi.fn<TaskSurfaceActions["updateTask"]>(),
    moveTask: vi.fn<TaskSurfaceActions["moveTask"]>(),
    batchUpdate: vi.fn<TaskSurfaceActions["batchUpdate"]>(async () => {}),
    batchDelete: vi.fn<TaskSurfaceActions["batchDelete"]>(async () => {}),
  } satisfies TaskSurfaceActions;
}

function makeNav(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/",
    searchParams: new URLSearchParams(),
    getShareableUrl: (path) => `https://uniwork.test${path}`,
  };
}

type Mode = "list" | "board";

let renderIndex = 0;

function renderSurface({
  mode = "list",
  actions = makeActions(),
  withWorkspace = true,
  nav = makeNav(),
  withOpenTask = true,
}: {
  mode?: Mode;
  actions?: ReturnType<typeof makeActions> | null;
  withWorkspace?: boolean;
  nav?: NavigationAdapter | null;
  withOpenTask?: boolean;
} = {}) {
  const onOpenTask = vi.fn<(id: string) => void>();
  const openHandler = withOpenTask ? onOpenTask : undefined;
  renderIndex += 1;
  const store = getTaskSurfaceViewStore(`row-actions-${renderIndex}`);
  let ui =
    mode === "list" ? (
      <ListView categories={["todo"]} tasks={[sample]} onOpenTask={openHandler} />
    ) : (
      <BoardView categories={["todo"]} tasks={[sample]} onOpenTask={openHandler} />
    );
  ui = <ViewStoreProvider store={store}>{ui}</ViewStoreProvider>;
  if (actions) {
    ui = <TaskSurfaceActionsProvider actions={actions}>{ui}</TaskSurfaceActionsProvider>;
  }
  if (withWorkspace) {
    ui = (
      <WorkspaceProvider workspace={workspace} user={user}>
        {ui}
      </WorkspaceProvider>
    );
  }
  if (nav) ui = <NavigationProvider value={nav}>{ui}</NavigationProvider>;
  const result = render(wrap(ui));
  return { ...result, actions, onOpenTask };
}

const rowText = (mode: Mode) => (mode === "list" ? "Suite row" : "Suite row");

async function openContextMenu(mode: Mode = "list") {
  fireEvent.contextMenu(screen.getByText(rowText(mode)));
  return screen.findByRole("menu");
}

async function openKebab() {
  fireEvent.click(screen.getByRole("button", { name: "Thêm thao tác" }));
  return screen.findByRole("menu");
}

function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.trim() ?? "");
}

beforeEach(() => {
  vi.mocked(copyText).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/members")) {
      return {
        members: [
          { workspace_id: "w1", user_id: "u1", role: "member", email: "an@example.com", display_name: "An Nguyễn" },
          { workspace_id: "w1", user_id: "u2", role: "member", email: "binh@example.com", display_name: "Bình Trần" },
        ],
      };
    }
    return {};
  });
});

describe("RowActionsMenu: một danh sách, hai cách mở", () => {
  it("menu chuột phải và nút ba chấm hiện cùng hành động, đúng thứ tự", async () => {
    renderSurface();
    const expected = ["Mở", "Sao chép liên kết", "Đổi trạng thái", "Đổi người phụ trách", "Xóa"];

    const contextMenu = await openContextMenu();
    expect(itemNames(contextMenu)).toEqual(expected);
    fireEvent.keyDown(contextMenu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    const dropdown = await openKebab();
    expect(itemNames(dropdown)).toEqual(expected);
  });

  it("nút ba chấm là nút focus được, không bị disabled", () => {
    renderSurface();
    const kebab = screen.getByRole("button", { name: "Thêm thao tác" });
    expect(kebab).not.toBeDisabled();
    kebab.focus();
    expect(document.activeElement).toBe(kebab);
    expect(kebab.className).toContain("pointer-coarse:opacity-100");
  });

  it("ẩn Sao chép liên kết khi không có workspace", async () => {
    renderSurface({ withWorkspace: false });
    const menu = await openContextMenu();
    expect(itemNames(menu)).toEqual(["Mở", "Đổi trạng thái", "Đổi người phụ trách", "Xóa"]);
  });

  it("ẩn đổi trạng thái, người phụ trách và xóa khi không có surface actions", async () => {
    renderSurface({ actions: null });
    const menu = await openContextMenu();
    expect(itemNames(menu)).toEqual(["Mở", "Sao chép liên kết"]);
  });

  it("không có hành động nào thì không có nút ba chấm và chuột phải không mở menu", async () => {
    renderSurface({ actions: null, withWorkspace: false, withOpenTask: false });
    expect(screen.queryByRole("button", { name: "Thêm thao tác" })).toBeNull();
    fireEvent.contextMenu(screen.getByText("Suite row"));
    await act(async () => {});
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("RowActionsMenu: từng hành động", () => {
  it.each<Via>(["mouse", "keyboard"])("Mở gọi onOpenTask đúng một lần (%s)", async (via) => {
    const { onOpenTask } = renderSurface();
    const menu = await openContextMenu();
    await chooseItem(menu, "Mở", via);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });

  it("sao chép URL đầy đủ và báo thành công khi copyText trả true", async () => {
    vi.mocked(copyText).mockResolvedValue(true);
    renderSurface();
    const menu = await openContextMenu();
    await chooseItem(menu, "Sao chép liên kết", "mouse");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã sao chép liên kết"));
    expect(copyText).toHaveBeenCalledWith("https://uniwork.test/acme/team/tasks/t1");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("báo lỗi khi copyText trả false", async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    renderSurface();
    const menu = await openContextMenu();
    await chooseItem(menu, "Sao chép liên kết", "mouse");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không sao chép được liên kết"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("không có navigation thì sao chép đường dẫn tương đối", async () => {
    vi.mocked(copyText).mockResolvedValue(true);
    renderSurface({ nav: null });
    const menu = await openContextMenu();
    await chooseItem(menu, "Sao chép liên kết", "mouse");
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("/acme/team/tasks/t1"));
  });

  it("đánh dấu trạng thái hiện tại và đổi trạng thái qua updateTask", async () => {
    const { actions } = renderSurface();
    const menu = await openContextMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Đổi trạng thái" }));
    const current = await screen.findByRole("menuitemradio", { name: "Cần làm" });
    expect(current).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Đang làm" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Đang làm" }));
    expect(actions!.updateTask).toHaveBeenCalledWith(
      "t1",
      { status: "in_progress" },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("menu con người phụ trách có Chưa giao ở đầu và gửi id cùng kind", async () => {
    const { actions } = renderSurface();
    const menu = await openContextMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Đổi người phụ trách" }));
    await screen.findByRole("menuitemradio", { name: "Bình Trần" });
    const names = screen.getAllByRole("menuitemradio").map((el) => el.textContent?.trim());
    expect(names).toEqual(["Chưa giao", "An Nguyễn", "Bình Trần"]);
    expect(screen.getByRole("menuitemradio", { name: "An Nguyễn" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Bình Trần" }));
    expect(actions!.updateTask).toHaveBeenCalledWith(
      "t1",
      { assignee_id: "u2", assignee_kind: "human" },
      expect.anything(),
    );
  });

  it("chọn Chưa giao gửi assignee_id null kèm kind", async () => {
    const { actions } = renderSurface();
    const menu = await openContextMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Đổi người phụ trách" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Chưa giao" }));
    expect(actions!.updateTask).toHaveBeenCalledWith(
      "t1",
      { assignee_id: null, assignee_kind: "human" },
      expect.anything(),
    );
  });
});

describe("RowActionsMenu: xóa phải xác nhận", () => {
  it("bấm Xóa chỉ mở hộp thoại; Hủy không xóa", async () => {
    const { actions } = renderSurface();
    const menu = await openContextMenu();
    await chooseItem(menu, "Xóa", "mouse");
    const dialog = await screen.findByRole("alertdialog");
    expect(actions!.batchDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(actions!.batchDelete).not.toHaveBeenCalled();
  });

  it("chỉ nút xác nhận mới gọi batchDelete với đúng một id", async () => {
    const { actions } = renderSurface();
    const menu = await openKebab();
    await chooseItem(menu, "Xóa", "mouse");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa task" }));
    await waitFor(() => expect(actions!.batchDelete).toHaveBeenCalledTimes(1));
    expect(actions!.batchDelete).toHaveBeenCalledWith(["t1"]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã xóa task"));
  });

  it("báo lỗi khi xóa thất bại", async () => {
    const actions = makeActions();
    actions.batchDelete.mockRejectedValue(new Error("boom"));
    renderSurface({ actions });
    const menu = await openContextMenu();
    await chooseItem(menu, "Xóa", "mouse");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa task" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

describe.each<Mode>(["list", "board"])("nổi bọt trên %s: hành động không mở task", (mode) => {
  it("đối chứng: bấm vào hàng vẫn mở task", () => {
    const { onOpenTask } = renderSurface({ mode });
    fireEvent.click(screen.getByText("Suite row"));
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });

  describe.each<[string, "context" | "kebab"]>([
    ["menu chuột phải", "context"],
    ["nút ba chấm", "kebab"],
  ])("%s", (_label, opener) => {
    const open = () => (opener === "context" ? openContextMenu(mode) : openKebab());

    it("bấm nút ba chấm không mở task", async () => {
      if (opener !== "kebab") return;
      const { onOpenTask } = renderSurface({ mode });
      await openKebab();
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it.each<Via>(["mouse", "keyboard"])("Sao chép liên kết (%s)", async (via) => {
      vi.mocked(copyText).mockResolvedValue(true);
      const { onOpenTask } = renderSurface({ mode });
      const menu = await open();
      await chooseItem(menu, "Sao chép liên kết", via);
      await waitFor(() => expect(copyText).toHaveBeenCalled());
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it.each<Via>(["mouse", "keyboard"])("đổi trạng thái (%s)", async (via) => {
      const { onOpenTask, actions } = renderSurface({ mode });
      const menu = await open();
      await chooseInSubmenu(menu, "Đổi trạng thái", "Đang làm", via);
      expect(actions!.updateTask).toHaveBeenCalled();
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it.each<Via>(["mouse", "keyboard"])("đổi người phụ trách (%s)", async (via) => {
      const { onOpenTask, actions } = renderSurface({ mode });
      const menu = await open();
      await chooseInSubmenu(menu, "Đổi người phụ trách", "Bình Trần", via);
      expect(actions!.updateTask).toHaveBeenCalled();
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it.each<Via>(["mouse", "keyboard"])("Xóa rồi xác nhận (%s)", async (via) => {
      const { onOpenTask, actions } = renderSurface({ mode });
      const menu = await open();
      await chooseItem(menu, "Xóa", via);
      const dialog = await screen.findByRole("alertdialog");
      expect(onOpenTask).not.toHaveBeenCalled();
      // Clicking inside the dialog body (not a button) must not reach the row either.
      fireEvent.click(within(dialog).getByText("Xóa task này?"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Xóa task" }));
      await waitFor(() => expect(actions!.batchDelete).toHaveBeenCalledWith(["t1"]));
      expect(onOpenTask).not.toHaveBeenCalled();
    });
  });
});

describe("board: menu không khởi động kéo thẻ hay kéo-cuộn bảng", () => {
  it("nhấn giữ và kéo trên một mục menu con không đưa thẻ vào trạng thái kéo", async () => {
    renderSurface({ mode: "board" });
    const menu = await openContextMenu("board");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Đổi trạng thái" }));
    const radio = await screen.findByRole("menuitemradio", { name: "Đang làm" });

    // useBoardDragPan sets user-select: none inline on its scroll container
    // when a pan starts. Record which elements already carry it (Base UI and
    // dnd-kit may set it themselves) so only a change caused by this press counts.
    const selectionSuppressed = () =>
      Array.from(document.querySelectorAll<HTMLElement>("*"))
        .filter((el) => el.style.userSelect === "none")
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    const before = selectionSuppressed();
    const grabbing = () =>
      Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
        (el) => el.style.cursor === "grabbing",
      );

    // Base UI nests portals, so this one pointerdown reaches the board's React
    // handler twice. Check right after it: a move without `buttons` makes the
    // pan hook reset and would hide a pan that did start.
    fireEvent.pointerDown(radio, { button: 0, buttons: 1, clientX: 0, clientY: 0 });
    expect(selectionSuppressed()).toEqual(before);

    fireEvent.pointerMove(document, { buttons: 1, clientX: 40, clientY: 0 });
    fireEvent.pointerMove(radio, { buttons: 1, clientX: 40, clientY: 0 });

    const card = document.querySelector("[data-board-card]") as HTMLElement;
    expect(card.className).not.toContain("opacity-30");
    expect(document.querySelector("[aria-pressed='true']")).toBeNull();
    expect(selectionSuppressed()).toEqual(before);
    expect(grabbing()).toEqual([]);
    fireEvent.pointerUp(document, { clientX: 40, clientY: 0 });
  });
});
