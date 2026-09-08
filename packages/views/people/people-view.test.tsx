import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
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
    vi.useRealTimers();
  });

  it("lists people with their title and department", async () => {
    mockApi("member");
    renderView();
    expect(await screen.findByText("Nguyễn Văn Ân")).toBeInTheDocument();
    expect(screen.getByText("Trưởng nhóm · Kỹ thuật · an@acme.vn")).toBeInTheDocument();
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

  it("says the directory is empty rather than showing placeholder rows", async () => {
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
