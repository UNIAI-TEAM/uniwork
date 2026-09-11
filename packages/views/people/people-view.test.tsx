import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { resetPeopleViewStoreForTests, usePeopleViewStore } from "@uniwork/core/people/view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { PeopleView } from "./people-view";

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
function mockApi(role: string, people: unknown[] = [an]) {
  const peopleCalls: string[] = [];
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/orgs/acme/people")) {
      peopleCalls.push(path);
      return Promise.resolve({ people, total_active: people.length });
    }
    if (path.startsWith("/api/v1/orgs/acme/departments")) {
      return Promise.resolve({ departments: [{ id: "d1", name: "Kỹ thuật" }] });
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

  it("opens on the card view, with the title, department and email of each person", async () => {
    mockApi("member");
    renderView();
    expect(await screen.findByText("Nguyễn Văn Ân")).toBeInTheDocument();
    expect(screen.getByText("Trưởng nhóm")).toBeInTheDocument();
    expect(screen.getByText("Kỹ thuật")).toBeInTheDocument();
    expect(screen.getByText("an@acme.vn")).toBeInTheDocument();
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

  it("shows the clear button only while a filter is set", async () => {
    mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");
    expect(screen.queryByRole("button", { name: "Xóa bộ lọc" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    fireEvent.click(await screen.findByText("Trạng thái"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Tất cả" }));

    // It arrives to the left of the view button, so that button does not move.
    await screen.findByRole("button", { name: "Xóa bộ lọc" });
    expect(isLastControl(viewButton())).toBe(true);
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

  it("sends the department chosen in the filter menu to the server", async () => {
    const calls = mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");

    fireEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    fireEvent.click(await screen.findByText("Phòng ban"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Kỹ thuật" }));

    await waitFor(() => expect(calls.some((c) => c.includes("department_id=d1"))).toBe(true));
    expect(screen.getByRole("button", { name: "1 bộ lọc" })).toBeInTheDocument();
  });

  it("clears every filter at once", async () => {
    const calls = mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");

    fireEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    fireEvent.click(await screen.findByText("Trạng thái"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Tất cả" }));
    await waitFor(() => expect(calls.some((c) => c.includes("status=all"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    await waitFor(() => expect(calls.some((c) => c.includes("status=active"))).toBe(true));
    expect(screen.queryByRole("button", { name: "Xóa bộ lọc" })).toBeNull();
  });

  it("debounces the search box into one request rather than one per keystroke", async () => {
    const calls = mockApi("member");
    renderView();
    await screen.findByText("Nguyễn Văn Ân");
    const initial = calls.length;
    const box = screen.getByRole("textbox", { name: "Tìm người" });
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
    expect(screen.queryByRole("link", { name: "Xuất CSV" })).toBeNull();
    unmount();

    mockApi("owner");
    renderView();
    expect(await screen.findByRole("link", { name: "Xuất CSV" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/v1/orgs/acme/people.csv"),
    );
  });

  it("says the directory is empty rather than showing placeholder cards", async () => {
    mockApi("owner", []);
    renderView();
    expect(await screen.findByText("Chỉ có bạn trong tổ chức")).toBeInTheDocument();
  });

  it("tells the difference between an empty directory and an empty filter", async () => {
    mockApi("owner", []);
    renderView();
    await screen.findByText("Chỉ có bạn trong tổ chức");
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm người" }), {
      target: { value: "khong-co-ai" },
    });
    expect(await screen.findByText("Không có ai khớp bộ lọc")).toBeInTheDocument();
  });
});
