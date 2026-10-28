import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { SignInMethodsSection } from "./security-sign-in-methods";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

initI18n();

/**
 * Setting the first password and changing it (spec §4.5): a change is
 * proved by the current password (or the second factor when it is on), a
 * first password through the proof dialog; refusals stay under their field.
 */
const USER = {
  id: "u1", email: "an@company.vn", display_name: "An", onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "vi", has_password: true,
};
const METHODS = {
  password: { set: true, changed_at: null },
  google: { linked: true, email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};
const PROVIDERS = { google: true, apple: false, apple_web: false, google_native: false };
const GRANT = { step_up_token: "sut-1", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "email_code" };

type Answer = unknown | ((body: Record<string, unknown> | undefined) => unknown);
function route(map: Record<string, Answer>) {
  requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    const key = `${opts?.method ?? "GET"} ${path}`;
    if (!(key in map)) throw new Error(`unexpected ${key}`);
    const answer = map[key];
    return typeof answer === "function" ? (answer as (body: unknown) => unknown)(opts?.body) : answer;
  });
}
const puts = () => requestMock.mock.calls.filter(([path]) => path === "/api/v1/me/password");

async function openDialog(action: string, title: string) {
  render(wrapWithNav(<SignInMethodsSection />, fakeNav("/acme/team/settings?tab=security")));
  fireEvent.click(await screen.findByRole("button", { name: action }));
  return within(await screen.findByRole("dialog", { name: title }));
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockReset();
  resetAuthStoreForTests();
  setSessionUser(USER);
});

describe("PasswordDialog", () => {
  it("changes the password with the current one, and keeps every refusal under its field", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "PUT /api/v1/me/password": (body: Record<string, unknown> | undefined) =>
        body?.current_password === "old-password"
          ? { user: USER, sign_in_methods: { ...METHODS, password: { set: true, changed_at: "2026-10-28T08:00:00Z" } } }
          : Promise.reject(new ApiError("wrong", "password_incorrect", 403)),
    });
    const dialog = await openDialog("Đổi mật khẩu", "Đổi mật khẩu");
    expect(dialog.getByText("Các thiết bị khác sẽ đăng xuất.")).toBeInTheDocument();
    const current = dialog.getByLabelText("Mật khẩu hiện tại");
    const next = dialog.getByLabelText("Mật khẩu mới");
    const confirm = dialog.getByLabelText("Nhập lại mật khẩu mới");

    fireEvent.click(dialog.getByRole("button", { name: "Lưu mật khẩu" }));
    expect(await dialog.findByText("Nhập mật khẩu hiện tại.")).toBeInTheDocument();
    expect(dialog.getByText("Mật khẩu cần ít nhất 8 ký tự.")).toBeInTheDocument();
    await waitFor(() => expect(current).toHaveFocus());

    fireEvent.change(current, { target: { value: "wrong-one" } });
    fireEvent.change(next, { target: { value: "brand-new-pass" } });
    fireEvent.change(confirm, { target: { value: "brand-new-pas" } });
    fireEvent.click(dialog.getByRole("button", { name: "Lưu mật khẩu" }));
    expect(await dialog.findByText("Hai mật khẩu chưa khớp.")).toBeInTheDocument();
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(puts()).toHaveLength(0);

    fireEvent.change(confirm, { target: { value: "brand-new-pass" } });
    fireEvent.click(dialog.getByRole("button", { name: "Lưu mật khẩu" }));
    expect(await dialog.findByText("Mật khẩu hiện tại chưa đúng.")).toBeInTheDocument();
    expect(current).toHaveValue("");
    await waitFor(() => expect(current).toHaveFocus());
    // The current password proved it: no "confirm it's you" was asked.
    expect(screen.queryByRole("dialog", { name: "Xác nhận là bạn" })).toBeNull();

    fireEvent.change(current, { target: { value: "old-password" } });
    fireEvent.click(dialog.getByRole("button", { name: "Lưu mật khẩu" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã đổi mật khẩu. Các thiết bị khác đã đăng xuất."));
    expect(puts().at(-1)![1]).toMatchObject({ body: { new_password: "brand-new-pass", current_password: "old-password" } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Đổi mật khẩu" })).toBeNull());
  });

  it("shows each password on request, and offers the way out of a forgotten current one", async () => {
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    const dialog = await openDialog("Đổi mật khẩu", "Đổi mật khẩu");
    const current = dialog.getByLabelText("Mật khẩu hiện tại");
    // Opens on the field, not on "Quên mật khẩu?" ahead of it in the label row.
    await waitFor(() => expect(current).toHaveFocus());
    expect(dialog.getByRole("link", { name: "Quên mật khẩu?" })).toHaveAttribute("href", "/forgot-password");
    const reveals = dialog.getAllByRole("button", { name: "Hiện mật khẩu" });
    expect(reveals).toHaveLength(3);
    fireEvent.click(reveals[1]!);
    expect(dialog.getByLabelText("Mật khẩu mới")).toHaveAttribute("type", "text");
    expect(current).toHaveAttribute("type", "password");
  });

  it("sets a first password behind a mailed code", async () => {
    setSessionUser({ ...USER, has_password: false });
    route({
      "GET /api/v1/me/sign-in-methods": { ...METHODS, password: { set: false, changed_at: null }, proofs: ["email_code"] },
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up/email-code": { status: "sent" },
      "POST /api/v1/me/step-up": GRANT,
      "PUT /api/v1/me/password": { user: { ...USER, has_password: true }, sign_in_methods: METHODS },
    });
    const dialog = await openDialog("Đặt mật khẩu", "Đặt mật khẩu");
    expect(dialog.getByText("Bạn sẽ đăng nhập bằng an@company.vn và mật khẩu này.")).toBeInTheDocument();
    expect(dialog.queryByLabelText("Mật khẩu hiện tại")).toBeNull();
    fireEvent.change(dialog.getByLabelText("Mật khẩu mới"), { target: { value: "brand-new-pass" } });
    fireEvent.change(dialog.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: "brand-new-pass" } });
    fireEvent.click(dialog.getByRole("button", { name: "Lưu mật khẩu" }));

    const proof = within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }));
    expect(proof.getByText("Để bảo vệ tài khoản, xác nhận là bạn trước khi đặt mật khẩu.")).toBeInTheDocument();
    fireEvent.click(proof.getByRole("button", { name: "Gửi mã tới an@company.vn" }));
    fireEvent.change(await proof.findByLabelText("Mã trong email"), { target: { value: "654321" } });
    // The sixth digit sends it.

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã đặt mật khẩu."));
    expect(puts()[0]![1]).toMatchObject({ body: { new_password: "brand-new-pass", step_up_token: "sut-1" } });
    expect(useAuthStore.getState().user?.has_password).toBe(true);
  });

  it("proves a change with the second factor when it is on, never the current password", async () => {
    setSessionUser({ ...USER, mfa_enabled_at: "2026-01-01T00:00:00Z" });
    route({
      "GET /api/v1/me/sign-in-methods": { ...METHODS, proofs: ["totp"] },
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": { ...GRANT, method: "totp" },
      "PUT /api/v1/me/password": { user: USER, sign_in_methods: METHODS },
    });
    const dialog = await openDialog("Đổi mật khẩu", "Đổi mật khẩu");
    expect(dialog.queryByLabelText("Mật khẩu hiện tại")).toBeNull();
    fireEvent.change(dialog.getByLabelText("Mật khẩu mới"), { target: { value: "brand-new-pass" } });
    fireEvent.change(dialog.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: "brand-new-pass" } });
    fireEvent.click(dialog.getByRole("button", { name: "Lưu mật khẩu" }));
    const proof = within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }));
    fireEvent.change(proof.getByLabelText("Mã từ ứng dụng xác thực"), { target: { value: "123456" } });
    fireEvent.click(proof.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(puts()[0]![1]).toMatchObject({ body: { new_password: "brand-new-pass", step_up_token: "sut-1" } }));
  });

  it("shows Apple's hidden address, with a way to copy it, before a first password", async () => {
    const relay = "x1@privaterelay.appleid.com";
    setSessionUser({ ...USER, email: relay, has_password: false });
    route({
      "GET /api/v1/me/sign-in-methods": {
        ...METHODS,
        password: { set: false, changed_at: null },
        google: { linked: false, email: null, linked_at: null },
        apple: { linked: true, email: relay, linked_at: null, private_relay: true },
        account_email_is_relay: true,
        proofs: ["email_code"],
      },
      "GET /api/v1/auth/providers": PROVIDERS,
    });
    const dialog = await openDialog("Đặt mật khẩu", "Đặt mật khẩu");
    expect(dialog.getByText("Bạn sẽ đăng nhập bằng email ẩn của Apple dưới đây và mật khẩu này.")).toBeInTheDocument();
    expect(dialog.getByText(relay)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Sao chép email" })).toBeInTheDocument();
  });
});
