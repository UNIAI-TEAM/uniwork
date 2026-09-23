import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { DepartmentsTab } from "./departments-tab";

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
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

type Init = { method?: string; body?: unknown } | undefined;

function mockApi(role: string, departments: unknown[]) {
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path.endsWith("/members/me")) return Promise.resolve({ role });
    if (path.includes("/departments") && !init?.method) return Promise.resolve({ departments });
    if (init?.method) return Promise.resolve({ department: { id: "d1", name: "Kỹ thuật mới" } });
    return Promise.resolve({});
  });
}

const writes = () =>
  requestMock.mock.calls
    .filter(([, init]) => (init as Init)?.method)
    .map(([path, init]) => ({ path: String(path), method: (init as Init)!.method, body: (init as Init)!.body }));

function renderTab() {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <DepartmentsTab />
      </WorkspaceProvider>,
    ),
  );
}

const tree = [
  { id: "d1", name: "Kỹ thuật", code: "KT", member_count: 3 },
  { id: "d2", name: "Frontend", parent_id: "d1", member_count: 2 },
  { id: "d3", name: "Kinh doanh", member_count: 0 },
];

describe("DepartmentsTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("renames only in edit mode: Esc puts the name back, Enter saves", async () => {
    mockApi("admin", tree);
    renderTab();
    const row = (await screen.findByText("Kỹ thuật")).closest("li")!;
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Đổi tên" }));
    const input = within(row).getByRole("textbox", { name: "Tên mới cho Kỹ thuật" });
    fireEvent.change(input, { target: { value: "Bỏ đi" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(row).getByText("Kỹ thuật")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    fireEvent.click(within(row).getByRole("button", { name: "Đổi tên" }));
    const again = within(row).getByRole("textbox", { name: "Tên mới cho Kỹ thuật" });
    fireEvent.change(again, { target: { value: "Kỹ thuật mới" } });
    fireEvent.keyDown(again, { key: "Enter" });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ path: "/api/v1/orgs/acme/departments/d1", body: { name: "Kỹ thuật mới" } });
  });

  it("archives only after a confirmation that states the member count", async () => {
    mockApi("admin", tree);
    renderTab();
    const row = (await screen.findByText("Frontend")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Lưu trữ" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Lưu trữ Frontend?");
    expect(dialog).toHaveTextContent("2 thành viên đang thuộc phòng này sẽ được bỏ gán phòng ban.");
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.path).toContain("/departments/d2");
  });

  it("keeps a parent with sub-departments from being archived and says why", async () => {
    mockApi("admin", tree);
    renderTab();
    const row = (await screen.findByText("Kỹ thuật")).closest("li")!;
    expect(row).toHaveTextContent("Có 1 phòng con, lưu trữ phòng con trước.");
    const archive = within(row).getByRole("button", { name: "Lưu trữ" });
    expect(archive).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(archive);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows an empty state with the next step, and a top-level parent choice", async () => {
    mockApi("admin", []);
    renderTab();
    expect(await screen.findByText("Chưa có phòng ban nào. Thêm phòng đầu tiên ở khung bên dưới.")).toBeInTheDocument();
    expect(screen.getByText("Chưa có phòng cấp cao nhất nào, nên phòng này sẽ ở cấp cao nhất.")).toBeInTheDocument();
    expect(screen.getByLabelText("Thuộc phòng")).toHaveTextContent("Cấp cao nhất (không thuộc phòng nào)");
  });
});
