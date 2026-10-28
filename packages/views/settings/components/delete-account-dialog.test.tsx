import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { DeleteAccountDialog } from "./delete-account-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

initI18n();

/**
 * Deleting the account (spec §4.5): the question, then "Xác nhận là bạn"
 * through the shared proof dialog with whatever proof the account takes,
 * then what an owner must decide when the server says it still owns an
 * organization: close it with the account, or hand it over first.
 */
const USER = {
  id: "u1", email: "an@company.vn", display_name: "An", onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "vi", has_password: true,
};
const METHODS = {
  password: { set: true, changed_at: null },
  google: { linked: false, email: null, linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};
const grant = (token: string, method = "password") => ({
  step_up_token: token,
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  method,
});
const OWNED = { organization_name: "Acme", organization_slug: "acme", can_close: true };

type Answer = unknown | ((body: Record<string, unknown> | undefined) => unknown);
function route(map: Record<string, Answer>) {
  const all: Record<string, Answer> = {
    "GET /api/v1/me/sign-in-methods": METHODS,
    "POST /api/v1/auth/logout": { status: "ok" },
    ...map,
  };
  requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    const key = `${opts?.method ?? "GET"} ${path}`;
    if (!(key in all)) throw new Error(`unexpected ${key}`);
    const answer = all[key];
    return typeof answer === "function" ? (answer as (body: unknown) => unknown)(opts?.body) : answer;
  });
}
const bodiesOf = (key: string) =>
  requestMock.mock.calls
    .filter(([path, opts]) => `${(opts as { method?: string } | undefined)?.method ?? "GET"} ${path}` === key)
    .map(([, opts]) => (opts as { body?: unknown }).body);
const refuse = (code: string, status: number, fields?: Record<string, unknown>) =>
  Promise.reject(new ApiError(code, code, status, undefined, fields));

function open() {
  const nav = fakeNav("/acme/team/settings?tab=security");
  render(wrapWithNav(<DeleteAccountDialog />, nav));
  fireEvent.click(screen.getByRole("button", { name: "Xóa tài khoản" }));
  return nav;
}
const question = async () => within(await screen.findByRole("dialog", { name: "Xóa tài khoản của bạn?" }));
const proofDialog = async () => within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }));
/** The footer's "Đóng", not the corner's (both close; the corner's is an icon). */
const footerClose = (dialog: ReturnType<typeof within>) =>
  dialog.getAllByRole("button", { name: "Đóng" }).find((b) => b.getAttribute("data-slot") !== "dialog-close")!;
async function prove(password = "password123") {
  const proof = await proofDialog();
  fireEvent.change(await proof.findByLabelText("Mật khẩu hiện tại"), { target: { value: password } });
  fireEvent.click(proof.getByRole("button", { name: "Xác nhận" }));
  return proof;
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  resetAuthStoreForTests();
  setSessionUser(USER);
});

describe("DeleteAccountDialog", () => {
  it("asks the question, then who it is, and goes to sign-in once the account is gone", async () => {
    route({
      "POST /api/v1/me/step-up": (body: Record<string, unknown> | undefined) =>
        body?.password === "password123" ? grant("sut-1") : refuse("password_incorrect", 403),
      "POST /api/v1/me/delete": {},
    });
    const nav = open();
    const dialog = await question();
    expect(dialog.getByText("Email, tên, ảnh và mọi cách đăng nhập của bạn bị xóa.")).toBeInTheDocument();
    // No proof field of its own: the proof dialog asks.
    expect(dialog.queryByLabelText(/mật khẩu/i)).toBeNull();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass("bg-black/45");

    fireEvent.click(dialog.getByRole("button", { name: "Xóa vĩnh viễn" }));
    const proof = await proofDialog();
    expect(proof.getByText("Để bảo vệ tài khoản, xác nhận là bạn trước khi xóa tài khoản.")).toBeInTheDocument();
    // A wrong password is answered where it was typed, and nothing is deleted.
    await prove("nope");
    expect(await proof.findByText("Mật khẩu chưa đúng. Nhập lại.")).toBeInTheDocument();
    expect(bodiesOf("POST /api/v1/me/delete")).toHaveLength(0);

    await prove();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/login"));
    expect(bodiesOf("POST /api/v1/me/delete")).toEqual([{ step_up_token: "sut-1" }]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("deletes nothing when the proof dialog is closed instead", async () => {
    route({});
    open();
    fireEvent.click((await question()).getByRole("button", { name: "Xóa vĩnh viễn" }));
    fireEvent.click((await proofDialog()).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Xác nhận là bạn" })).toBeNull());
    // The question stays open, ready to be asked again.
    expect((await question()).getByRole("button", { name: "Xóa vĩnh viễn" })).toBeInTheDocument();
    expect(bodiesOf("POST /api/v1/me/delete")).toHaveLength(0);
  });

  it("lets an account without a password prove it with a code mailed for this deletion", async () => {
    setSessionUser({ ...USER, has_password: false });
    route({
      "GET /api/v1/me/sign-in-methods": { ...METHODS, password: { set: false, changed_at: null }, proofs: ["email_code"] },
      "POST /api/v1/me/step-up/email-code": { status: "sent" },
      "POST /api/v1/me/step-up": (body: Record<string, unknown> | undefined) =>
        body?.code === "123456" ? grant("sut-mail", "email_code") : refuse("step_up_code_incorrect", 403),
      "POST /api/v1/me/delete": {},
    });
    const nav = open();
    fireEvent.click((await question()).getByRole("button", { name: "Xóa vĩnh viễn" }));
    const proof = await proofDialog();
    fireEvent.click(await proof.findByRole("button", { name: "Gửi mã tới an@company.vn" }));
    fireEvent.change(await proof.findByLabelText("Mã trong email"), { target: { value: "123456" } });
    fireEvent.click(proof.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/login"));
    expect(bodiesOf("POST /api/v1/me/step-up/email-code")).toEqual([{ action: "delete_account" }]);
    expect(bodiesOf("POST /api/v1/me/step-up")).toEqual([{ code: "123456", action: "delete_account" }]);
    expect(bodiesOf("POST /api/v1/me/delete")).toEqual([{ step_up_token: "sut-mail" }]);
  });

  it("asks again, on the proofs the server names, when the held token no longer serves", async () => {
    let tokens = 0;
    let deletes = 0;
    route({
      "POST /api/v1/me/step-up": () => grant(`sut-${++tokens}`),
      "POST /api/v1/me/delete": () => (deletes++ === 0 ? refuse("proof_required", 403, { proofs: ["password"] }) : {}),
    });
    const nav = open();
    fireEvent.click((await question()).getByRole("button", { name: "Xóa vĩnh viễn" }));
    await prove();
    const again = await proofDialog();
    // The server named the password alone: no other way is offered.
    expect(again.queryByRole("button", { name: "Dùng cách khác" })).toBeNull();
    await prove();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/login"));
    expect(bodiesOf("POST /api/v1/me/delete")).toEqual([{ step_up_token: "sut-1" }, { step_up_token: "sut-2" }]);
  });

  it("closes the organization with the account when its only member types its slug back", async () => {
    let deletes = 0;
    route({
      "POST /api/v1/me/step-up": grant("sut-1"),
      "POST /api/v1/me/delete": () => (deletes++ === 0 ? refuse("owner_must_transfer", 409, OWNED) : {}),
    });
    const nav = open();
    const dialog = await question();
    fireEvent.click(dialog.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await prove();

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Bạn là thành viên duy nhất của Acme, nên tổ chức sẽ được đóng cùng lúc với tài khoản.",
    );
    const slug = dialog.getByLabelText("Gõ định danh tổ chức để xác nhận");
    await waitFor(() => expect(slug).toHaveFocus());
    const action = dialog.getByRole("button", { name: "Đóng tổ chức và xóa tài khoản" });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveAccessibleDescription("Gõ đúng định danh tổ chức để đóng.");
    fireEvent.click(action);
    expect(bodiesOf("POST /api/v1/me/delete")).toHaveLength(1);

    fireEvent.change(slug, { target: { value: "acme-x" } });
    expect(slug).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(slug, { target: { value: "acme" } });
    expect(action).not.toHaveAttribute("aria-disabled");
    fireEvent.click(action);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/login"));
    // The first press's token proves the second: one proof in all.
    expect(bodiesOf("POST /api/v1/me/step-up")).toHaveLength(1);
    expect(bodiesOf("POST /api/v1/me/delete")).toEqual([
      { step_up_token: "sut-1" },
      { close_organization: "acme", step_up_token: "sut-1" },
    ]);
  });

  it("tells the owner of an organization others are in to hand it over first, with nothing left to press", async () => {
    route({
      "POST /api/v1/me/step-up": grant("sut-1"),
      "POST /api/v1/me/delete": () => refuse("owner_must_transfer", 409, { ...OWNED, can_close: false }),
    });
    open();
    const dialog = await question();
    fireEvent.click(dialog.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await prove();
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Bạn là chủ sở hữu Acme, và tổ chức còn thành viên khác. Chuyển quyền sở hữu trong Cài đặt › Thành viên tổ chức, rồi quay lại xóa tài khoản.",
    );
    expect(dialog.queryByRole("button", { name: "Xóa vĩnh viễn" })).toBeNull();
    await waitFor(() => expect(footerClose(dialog)).toHaveFocus());
  });

  it("falls back to the general owner sentence when the refusal names no organization", async () => {
    route({
      "POST /api/v1/me/step-up": grant("sut-1"),
      "POST /api/v1/me/delete": () => refuse("owner_must_transfer", 409),
    });
    open();
    const dialog = await question();
    fireEvent.click(dialog.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await prove();
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Tài khoản đang là chủ sở hữu tổ chức không xóa được cho đến khi chuyển quyền.",
    );
  });

  it("turns the close into a hand-over when somebody joined meanwhile, and starts over on the next opening", async () => {
    let deletes = 0;
    route({
      "POST /api/v1/me/step-up": grant("sut-1"),
      "POST /api/v1/me/delete": () =>
        deletes++ === 0 ? refuse("owner_must_transfer", 409, OWNED) : refuse("organization_has_members", 409),
    });
    open();
    const dialog = await question();
    fireEvent.click(dialog.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await prove();
    fireEvent.change(await dialog.findByLabelText("Gõ định danh tổ chức để xác nhận"), { target: { value: "acme" } });
    fireEvent.click(dialog.getByRole("button", { name: "Đóng tổ chức và xóa tài khoản" }));
    await waitFor(() => expect(dialog.getByRole("alert")).toHaveTextContent(/Bạn là chủ sở hữu Acme, và tổ chức còn thành viên khác/));
    expect(dialog.queryByLabelText("Gõ định danh tổ chức để xác nhận")).toBeNull();

    fireEvent.click(footerClose(dialog));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Xóa tài khoản" }));
    expect((await question()).getByRole("button", { name: "Xóa vĩnh viễn" })).toBeInTheDocument();
  });

  it("says a failure that is neither in the dialog, not in a toast it would cover", async () => {
    route({
      "POST /api/v1/me/step-up": grant("sut-1"),
      "POST /api/v1/me/delete": () => refuse("server_error", 503),
    });
    open();
    const dialog = await question();
    fireEvent.click(dialog.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await prove();
    expect(await dialog.findByText("Không xóa được tài khoản")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    // The question stays, so the same button tries again.
    expect(dialog.getByRole("button", { name: "Xóa vĩnh viễn" })).not.toHaveAttribute("aria-disabled");
  });
});
