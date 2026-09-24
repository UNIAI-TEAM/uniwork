import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { resetPeopleViewStoreForTests, usePeopleViewStore } from "@uniwork/core/people/view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { PeopleView } from "./people-view";

const exportMock = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/endpoints/people", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/people")>()),
  exportPeopleCsv: (...a: unknown[]) => exportMock(...a),
}));

initI18n();

const user: User = {
  id: "u1",
  email: "ha@acme.vn",
  display_name: "Đỗ Thị Hà",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "ws1",
  slug: "doi",
  name: "Đội",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const an = {
  user_id: "u2",
  display_name: "Nguyễn Văn Ân",
  email: "an@acme.vn",
  org_role: "member",
  status: "active",
  title: "Trưởng nhóm",
  department: { id: "d1", name: "Kỹ thuật" },
};

/** The view-mode button, whose position the toolbar is built to hold still. */
function viewButton(): HTMLElement {
  return screen.getByRole("button", { name: /Chế độ xem/ });
}

/** The right-hand control group of the toolbar. */
function toolbarGroup(): HTMLElement {
  const group = viewButton().parentElement;
  if (!group) throw new Error("view button has no toolbar group");
  return group;
}

/** Last in a flush-right group is the one position that cannot move. */
function isLastControl(button: HTMLElement): boolean {
  const buttons = toolbarGroup().querySelectorAll("button");
  return buttons[buttons.length - 1] === button;
}

/** Records every people request so the test can assert what the screen asked for. */
function mockApi(role: string, people: unknown[] = [an], total = people.length) {
  const peopleCalls: string[] = [];
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/orgs/acme/people")) {
      peopleCalls.push(path);
      return Promise.resolve({ people, total_active: people.length, total });
    }
    if (path.startsWith("/api/v1/orgs/acme/departments")) {
      return Promise.resolve({ departments: [{ id: "d1", name: "Kỹ thuật", member_count: 1 }] });
    }
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role });
    return Promise.resolve({});
  });
  return peopleCalls;
}

function renderView() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <PeopleView />
      </WorkspaceProvider>,
    ),
  );
}

describe("PeopleView", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
    localStorage.clear();
    resetPeopleViewStoreForTests();
    vi.useRealTimers();
  });

  it("opens on the card view, with the title, department and ways to reach each person", async () => {
    mockApi("member");
    renderView();
    expect(await screen.findByText("Nguyễn Văn Ân")).toBeInTheDocument();
    expect(screen.getByText("Trưởng nhóm")).toBeInTheDocument();
    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent("Kỹ thuật");
    expect(screen.getByRole("link", { name: "Gửi email cho Nguyễn Văn Ân" })).toHaveAttribute(
      "href",
      "mailto:an@acme.vn",
    );
    expect(screen.getByRole("button", { name: "Nhắn tin cho Nguyễn Văn Ân" })).toBeInTheDocument();
    // A card view has no column headers.
    expect(screen.queryByRole("columnheader")).toBeNull();
  });

  it("switches to the table view from the toolbar and remembers the choice", async () => {
    mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");

    fireEvent.click(screen.getByRole("button", { name: /Chế độ xem/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Bảng" }));

    expect(await screen.findByText("Tên")).toBeInTheDocument();
    expect(usePeopleViewStore.getState().viewMode).toBe("table");
  });

  it("says which view is active in the button's accessible name", async () => {
    mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");
    // The visible word is part of the name (WCAG 2.5.3), and the purpose is
    // still said, so the button is not just "Thẻ" out of context.
    expect(screen.getByRole("button", { name: "Chế độ xem: Thẻ" })).toBeInTheDocument();
  });

  it("keeps the view button last in a flush-right toolbar when the view changes", async () => {
    mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");

    // The toolbar group is flush right, so only the last control has a fixed
    // position. Gaining the display button must not push the button the
    // cursor just clicked, which means that button stays last.
    expect(isLastControl(viewButton())).toBe(true);

    fireEvent.click(viewButton());
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Bảng" }));
    await screen.findByText("Tên");

    expect(isLastControl(viewButton())).toBe(true);
  });

  it("holds no blank slot open for a control the view does not have", async () => {
    mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");

    // Card view has no columns to configure and no filter to clear. Reserving
    // their width left a visible notch between the filter and view buttons,
    // which is the state the toolbar is in almost all the time.
    const group = toolbarGroup();
    expect(group.querySelectorAll("button")).toHaveLength(2);
    expect(group.querySelectorAll(".invisible")).toHaveLength(0);
  });

  it("says a set filter in words, removable on its own, left of the view button", async () => {
    mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");
    expect(screen.queryByRole("button", { name: "Bỏ lọc Trạng thái" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    fireEvent.click(await screen.findByText("Trạng thái"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Tất cả" }));

    expect(await screen.findByText("Trạng thái: Tất cả")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Bỏ lọc Trạng thái" });
    expect(isLastControl(viewButton())).toBe(true);
  });

  it("counts the matches the server reports, not the rows loaded so far", async () => {
    mockApi("member", [an], 37);
    renderView();
    await screen.findByText("Nguyễn Văn Ân");
    // Unfiltered, the header already counts the organization.
    expect(screen.queryByText(/người khớp/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    fireEvent.click(await screen.findByText("Trạng thái"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Tất cả" }));

    expect(await screen.findByText("37 người khớp")).toBeInTheDocument();
  });

  it("shows skeletons rather than a spinner while the first page loads", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderView();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("hides a table column from the display menu", async () => {
    mockApi("member");
    usePeopleViewStore.getState().setViewMode("table");
    renderView();
    expect(await screen.findByText("Email")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hiển thị" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Email" }));

    await waitFor(() => expect(screen.queryByText("an@acme.vn")).toBeNull());
    expect(usePeopleViewStore.getState().hiddenColumns).toContain("email");
  });

  it("filters by department in one click from the department row", async () => {
    const calls = mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");

    const chip = screen.getByRole("button", { name: /^Kỹ thuật/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);

    await waitFor(() => expect(calls.some((c) => c.includes("department_id=d1"))).toBe(true));
    expect(screen.getByRole("button", { name: /^Kỹ thuật/ })).toHaveAttribute("aria-pressed", "true");
    // The menu counts only what it holds; the department row shows its own state.
    expect(screen.getByRole("button", { name: "Bộ lọc" })).toBeInTheDocument();
  });

  it("removes one filter from its chip", async () => {
    const calls = mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");

    fireEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    fireEvent.click(await screen.findByText("Trạng thái"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Tất cả" }));
    await waitFor(() => expect(calls.some((c) => c.includes("status=all"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Bỏ lọc Trạng thái" }));
    await waitFor(() => expect(calls.some((c) => c.includes("status=active"))).toBe(true));
    expect(screen.queryByRole("button", { name: "Bỏ lọc Trạng thái" })).toBeNull();
  });

  it("debounces the search box into one request rather than one per keystroke", async () => {
    const calls = mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");
    const initial = calls.length;
    const box = screen.getByRole("searchbox", { name: "Tìm người" });
    fireEvent.change(box, { target: { value: "n" } });
    fireEvent.change(box, { target: { value: "ng" } });
    fireEvent.change(box, { target: { value: "nguyen" } });
    // Nothing is requested while the user is still typing.
    expect(calls.length).toBe(initial);
    await waitFor(() => expect(calls.some((c) => c.includes("q=nguyen"))).toBe(true));
    expect(calls.filter((c) => c.includes("q=")).length).toBe(1);
  });

  it("offers the export only to an organization admin", async () => {
    mockApi("member");
    const { unmount } = renderView();
    await screen.findByText("Nguyễn Văn Ân");
    expect(screen.queryByRole("button", { name: "Xuất CSV" })).toBeNull();
    unmount();

    mockApi("owner");
    renderView();
    expect(await screen.findByRole("button", { name: "Xuất CSV" })).toBeInTheDocument();
  });

  it("exports what is on screen: the CSV carries the current filters and is saved as a file", async () => {
    const createObjectURL = vi.fn(() => "blob:people");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    // jsdom cannot follow the download link; the save is what is asserted.
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportMock.mockReset().mockResolvedValue(new Blob(["name\n"], { type: "text/csv" }));
    mockApi("owner");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");
    fireEvent.click(screen.getByRole("button", { name: /^Kỹ thuật/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Xuất CSV theo bộ lọc" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(exportMock).toHaveBeenCalledWith("acme", expect.objectContaining({ department_id: "d1" }));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("stays in the app when the export is refused, and saves nothing", async () => {
    const createObjectURL = vi.fn(() => "blob:people");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    exportMock.mockReset().mockRejectedValue(new Error("forbidden"));
    mockApi("owner");
    renderView();
    const button = await screen.findByRole("button", { name: "Xuất CSV" });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(exportMock).toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("invites colleagues when the reader is the only person in it", async () => {
    mockApi("owner", [{ ...an, user_id: "u1", display_name: "Đỗ Thị Hà", is_self: true }]);
    renderView();
    expect(await screen.findByText("Chỉ có bạn trong tổ chức.")).toBeInTheDocument();
    // The reader's own card is still there, marked as theirs.
    expect(screen.getByText("Bạn")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mời đồng nghiệp" })).toHaveAttribute(
      "href",
      expect.stringContaining("/settings?tab=organization"),
    );
  });

  it("says the directory is empty rather than showing placeholder cards", async () => {
    mockApi("owner", []);
    renderView();
    expect(await screen.findByText("Chưa có ai trong danh bạ")).toBeInTheDocument();
  });

  it("tells a search with no match apart from filters with no match, and offers the way back", async () => {
    mockApi("owner", []);
    renderView();
    await screen.findByText("Chưa có ai trong danh bạ");
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm người" }), {
      target: { value: "khong-co-ai" },
    });
    expect(await screen.findByText("Không tìm thấy ai khớp “khong-co-ai”")).toBeInTheDocument();
    const clear = screen.getAllByRole("button", { name: "Xóa tìm kiếm" });
    fireEvent.click(clear[clear.length - 1]!);
    expect(await screen.findByText("Chưa có ai trong danh bạ")).toBeInTheDocument();
  });

  it("offers a retry when the directory cannot be loaded", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/orgs/acme/people")) {
        return fail ? Promise.reject(new Error("down")) : Promise.resolve({ people: [an], total_active: 1, total: 1 });
      }
      return Promise.resolve({});
    });
    renderView();
    const retry = await screen.findByRole("button", { name: "Thử lại" }, { timeout: 5000 });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText("Nguyễn Văn Ân")).toBeInTheDocument();
  });
});
