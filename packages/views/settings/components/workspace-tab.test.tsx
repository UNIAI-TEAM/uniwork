import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderAs(role: string, ws: Workspace = workspace, opts: { patch?: unknown; patchError?: unknown } = {}) {
  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u1", role, source: "membership" } });
    if (init?.method === "PATCH") return opts.patchError ? Promise.reject(opts.patchError) : Promise.resolve(opts.patch ?? {});
    return Promise.resolve({});
  });
  return render(
    wrap(
      <WorkspaceProvider workspace={ws} user={user}>
        <WorkspaceTab />
      </WorkspaceProvider>,
    ),
  );
}

const callsWith = (method: string) =>
  requestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === method);
const patchBodies = () => callsWith("PATCH").map(([, init]) => (init as { body?: unknown }).body);

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

  it("lets an admin edit the name, with the hint tied to the field and the server's length cap", async () => {
    renderAs("admin");
    const input = await screen.findByRole("textbox", { name: "Tên workspace" });
    expect(input).toHaveValue("Đội Sản phẩm");
    expect(input).toHaveAccessibleDescription("Hiện ở thanh bên, trong lời mời và email thông báo.");
    expect(input).toHaveAttribute("maxLength", "100");
  });

  it("flags an empty name instead of failing silently, and puts the name back on blur", async () => {
    renderAs("admin");
    const input = await screen.findByRole("textbox", { name: "Tên workspace" });
    fireEvent.change(input, { target: { value: "   " } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Tên workspace không được để trống\./);
    fireEvent.blur(input);
    expect(input).toHaveValue("Đội Sản phẩm");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Tên workspace không được để trống.")).toBeNull();
    expect(patchBodies()).toHaveLength(0);
  });

  it("autosaves the description for an admin", async () => {
    renderAs("admin");
    const box = await screen.findByRole("textbox", { name: "Mô tả" });
    fireEvent.change(box, { target: { value: "Nhóm làm sản phẩm" } });
    fireEvent.blur(box);
    await waitFor(() => expect(patchBodies()).toContainEqual({ description: "Nhóm làm sản phẩm" }));
  });

  it("shows a member the description as text, without icon actions", async () => {
    renderAs("member", { ...workspace, description: "Nhóm làm sản phẩm" });
    expect(await screen.findByText("Nhóm làm sản phẩm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chọn emoji" })).not.toBeInTheDocument();
  });

  it("uploads an image icon and removes an emoji icon", async () => {
    renderAs("admin", { ...workspace, icon_emoji: "🚀" });
    const input = await screen.findByLabelText("Tải ảnh lên", { selector: "input" });
    fireEvent.change(input, { target: { files: [new File(["x"], "i.png", { type: "image/png" })] } });
    await waitFor(() => expect(callsWith("POST").map(([path]) => path)).toContain("/api/v1/workspaces/ws1/icon"));
    fireEvent.click(screen.getByRole("button", { name: "Bỏ icon" }));
    await waitFor(() => expect(callsWith("DELETE").map(([path]) => path)).toContain("/api/v1/workspaces/ws1/icon"));
  });
});
