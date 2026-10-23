import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import type { NavigationAdapter } from "../navigation";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { NoWorkspaceView } from "./no-workspace-view";

initI18n();

const user: User = {
  id: "u1",
  email: "binh@beta.vn",
  display_name: "Trần Bình",
  onboarded_at: "2026-10-01T00:00:00Z",
  email_verified_at: "2026-10-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const beta = (role: string) => ({ id: "o2", slug: "beta", name: "Beta", role, status: "active" });

function nav(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/no-workspace",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
}

function serve(role: string, workspaces: () => unknown[] = () => []) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/orgs") return Promise.resolve({ organizations: [beta(role)] });
    if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: workspaces() });
    return Promise.resolve({});
  });
}

describe("NoWorkspaceView", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  /**
   * UNI-1472 / UNI-1582: a member whose invitation opened no workspace is told
   * where they are and who can let them in, and is offered nothing to create.
   */
  it("tells a member they are in the organization with no workspace yet, and offers no create", async () => {
    serve("member");
    render(wrapWithNav(<NoWorkspaceView />, nav()));
    expect(await screen.findByRole("heading", { level: 1, name: "Bạn chưa được cấp workspace" })).toBeInTheDocument();
    expect(screen.getByText(/Bạn đã tham gia Beta/)).toBeInTheDocument();
    expect(screen.getByText(/Nhờ quản trị viên của Beta/)).toBeInTheDocument();
    // The address is what an admin looks the person up by.
    expect(screen.getByText("binh@beta.vn")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tạo workspace" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tạo tổ chức/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng xuất" })).toBeInTheDocument();
  });

  it("offers the owner or an admin to create the first workspace", async () => {
    for (const role of ["owner", "admin"]) {
      serve(role);
      const { unmount } = render(wrapWithNav(<NoWorkspaceView />, nav()));
      const create = await screen.findByRole("link", { name: "Tạo workspace" });
      expect(create).toHaveAttribute("href", "/workspaces/new");
      unmount();
    }
  });

  it("checks again on request and goes to the workspace an admin has since opened", async () => {
    let granted: unknown[] = [];
    serve("member", () => granted);
    const adapter = nav();
    render(wrapWithNav(<NoWorkspaceView />, adapter));
    const check = await screen.findByRole("button", { name: "Kiểm tra lại" });
    granted = [
      { id: "w1", slug: "sales", name: "Sales", organization_id: "o2", organization_slug: "beta", organization_name: "Beta" },
    ];
    fireEvent.click(check);
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/beta/sales/tasks"));
  });

  it("sends somebody who belongs to no organization to /get-started", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/orgs" ? { organizations: [] } : { workspaces: [] }),
    );
    const adapter = nav();
    render(wrapWithNav(<NoWorkspaceView />, adapter));
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/get-started"));
  });

  it("holds its loading frame while the host resolves the session", () => {
    serve("member");
    render(wrapWithNav(<NoWorkspaceView pending />, nav()));
    expect(screen.queryByRole("heading", { name: "Bạn chưa được cấp workspace" })).not.toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
