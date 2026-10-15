import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { WorkspaceTab } from "./workspace-tab";

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

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
    toastError.mockReset();
    toastSuccess.mockReset();
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

  it("keeps the user's trailing space when the refetch returns the trimmed description", async () => {
    const { rerender } = renderAs("admin");
    const box = await screen.findByRole("textbox", { name: "Mô tả" });
    fireEvent.change(box, { target: { value: "hello " } });
    fireEvent.blur(box);
    await waitFor(() => expect(patchBodies()).toContainEqual({ description: "hello " }));
    rerender(
      wrap(
        <WorkspaceProvider workspace={{ ...workspace, description: "hello" }} user={user}>
          <WorkspaceTab />
        </WorkspaceProvider>,
      ),
    );
    expect(await screen.findByRole("textbox", { name: "Mô tả" })).toHaveValue("hello ");
  });

  it("still adopts a description changed elsewhere when the field is untouched", async () => {
    const { rerender } = renderAs("admin", { ...workspace, description: "cũ" });
    await screen.findByRole("textbox", { name: "Mô tả" });
    rerender(
      wrap(
        <WorkspaceProvider workspace={{ ...workspace, description: "mới" }} user={user}>
          <WorkspaceTab />
        </WorkspaceProvider>,
      ),
    );
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Mô tả" })).toHaveValue("mới"));
  });

  it("refuses an icon over 2 MiB without uploading it", async () => {
    renderAs("admin");
    const input = await screen.findByLabelText("Tải ảnh lên", { selector: "input" });
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 2 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Ảnh lớn hơn 2 MB. Chọn ảnh nhỏ hơn."));
    expect(callsWith("POST")).toHaveLength(0);
  });

  it("changes the task prefix with a preview of the new identifier", async () => {
    renderAs("admin", { ...workspace, task_prefix: "TASK" }, { patch: { workspace: { ...workspace, task_prefix: "MKT" } } });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi tiền tố" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Tiền tố mới" }), { target: { value: "mkt" } });
    expect(within(dialog).getByText("TASK-12 → MKT-12")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Đổi tiền tố" }));
    await waitFor(() => expect(patchBodies()).toContainEqual({ task_prefix: "MKT" }));
  });

  it("flags a task prefix the server would refuse instead of sending it", async () => {
    renderAs("admin", { ...workspace, task_prefix: "TASK" });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi tiền tố" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Tiền tố mới" }), { target: { value: "1ab" } });
    expect(within(dialog).getByText("Dùng 2–10 ký tự A–Z hoặc 0–9, bắt đầu bằng chữ.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Đổi tiền tố" }));
    expect(patchBodies()).toHaveLength(0);
  });

  it("does not offer a member the prefix change", async () => {
    renderAs("member", { ...workspace, task_prefix: "TASK" });
    expect(await screen.findByText("TASK")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đổi tiền tố" })).not.toBeInTheDocument();
  });

  it("changes the address in a dialog, normalising what is typed", async () => {
    renderAs("admin", workspace, { patch: { workspace: { ...workspace, slug: "doi-moi" } } });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi địa chỉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Địa chỉ mới" }), { target: { value: " Doi-Moi " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Đổi địa chỉ" }));
    await waitFor(() => expect(patchBodies()).toContainEqual({ slug: "doi-moi" }));
  });

  it("says the address is taken when the server answers 409", async () => {
    renderAs("admin", workspace, { patchError: new ApiError("already exists", "conflict", 409) });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi địa chỉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Địa chỉ mới" }), { target: { value: "doi-khac" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Đổi địa chỉ" }));
    expect(await within(dialog).findByText("Địa chỉ này đã được dùng trong tổ chức.")).toBeInTheDocument();
  });

  it("flags an address the server would refuse instead of sending it", async () => {
    renderAs("admin");
    fireEvent.click(await screen.findByRole("button", { name: "Đổi địa chỉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Địa chỉ mới" }), { target: { value: "a_b" } });
    expect(within(dialog).getByText("Chỉ dùng a–z, 0–9 và dấu gạch ngang, 2–40 ký tự.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Đổi địa chỉ" })).toBeDisabled();
    expect(patchBodies()).toHaveLength(0);
  });

  it("keeps what is typed in the address dialog when the workspace refetches", async () => {
    const { rerender } = renderAs("admin");
    fireEvent.click(await screen.findByRole("button", { name: "Đổi địa chỉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Địa chỉ mới" }), { target: { value: "dang-go" } });
    rerender(
      wrap(
        <WorkspaceProvider workspace={{ ...workspace, slug: "team-2" }} user={user}>
          <WorkspaceTab />
        </WorkspaceProvider>,
      ),
    );
    expect(within(await screen.findByRole("dialog")).getByRole("textbox", { name: "Địa chỉ mới" })).toHaveValue("dang-go");
  });

  it("does not offer a member the address change", async () => {
    renderAs("member");
    expect(await screen.findByText("/acme/team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đổi địa chỉ" })).not.toBeInTheDocument();
  });

  it("refuses a reserved address without sending it", async () => {
    renderAs("admin");
    fireEvent.click(await screen.findByRole("button", { name: "Đổi địa chỉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Địa chỉ mới" }), { target: { value: "admin" } });
    expect(within(dialog).getByText("Địa chỉ này được hệ thống dành riêng.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Đổi địa chỉ" })).toBeDisabled();
    expect(patchBodies()).toHaveLength(0);
  });

  it("keeps what is typed in the prefix dialog when the workspace refetches", async () => {
    const ws = { ...workspace, task_prefix: "TASK" };
    const { rerender } = renderAs("admin", ws);
    fireEvent.click(await screen.findByRole("button", { name: "Đổi tiền tố" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Tiền tố mới" }), { target: { value: "DANG" } });
    rerender(
      wrap(
        <WorkspaceProvider workspace={{ ...ws, task_prefix: "OTHER" }} user={user}>
          <WorkspaceTab />
        </WorkspaceProvider>,
      ),
    );
    expect(within(await screen.findByRole("dialog")).getByRole("textbox", { name: "Tiền tố mới" })).toHaveValue("DANG");
  });
});
