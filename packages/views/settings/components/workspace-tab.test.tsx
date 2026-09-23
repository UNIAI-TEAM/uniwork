import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { WorkspaceTab } from "./workspace-tab";

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
  name: "Đội Sản phẩm",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function renderAs(role: string) {
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u1", role, source: "membership" } });
    return Promise.resolve({});
  });
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <WorkspaceTab />
      </WorkspaceProvider>,
    ),
  );
}

describe("WorkspaceTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("shows a member the name as text, not a read-only field, with the address and organization", async () => {
    renderAs("member");
    expect(await screen.findByText("Chỉ chủ sở hữu và quản trị workspace đổi được tên.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Đội Sản phẩm")).toBeInTheDocument();
    expect(screen.getByText("/acme/team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sao chép địa chỉ" })).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    // No section heading repeating the tab title.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("lets an admin edit the name", async () => {
    renderAs("admin");
    expect(await screen.findByRole("textbox", { name: "Tên workspace" })).toHaveValue("Đội Sản phẩm");
  });
});
