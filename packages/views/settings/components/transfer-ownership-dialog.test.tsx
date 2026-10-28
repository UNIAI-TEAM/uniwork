import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import type { OrgMember } from "@uniwork/core/types/people";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";

initI18n();

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";

const user: User = {
  id: "u1",
  email: "ha@acme.vn",
  display_name: "Đỗ Thị Hà",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const candidates: OrgMember[] = [
  { user_id: "u2", email: "an@acme.vn", display_name: "Nguyễn Văn An", role: "admin", created_at: "" },
];

function dialog(open: boolean, organizationName: string, onOpenChange: (next: boolean) => void = () => {}) {
  return (
    <TransferOwnershipDialog
      orgSlug="acme"
      organizationName={organizationName}
      candidates={candidates}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

function renderDialog(organizationName = "Acme", onOpenChange?: (next: boolean) => void) {
  return render(wrapWithNav(dialog(true, organizationName, onOpenChange)));
}

const submitButton = () => screen.getByRole("button", { name: "Chuyển quyền" });

const SLOW = { timeout: 3000 };

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

type Answer = unknown | ((body: Record<string, unknown> | undefined) => unknown);
function route(map: Record<string, Answer>) {
  const all: Record<string, Answer> = { "GET /api/v1/me/sign-in-methods": METHODS, ...map };
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
const TRANSFER = "POST /api/v1/orgs/acme/transfer-ownership";
const proofDialog = async () => within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }, SLOW));

async function pickHeir() {
  const combobox = await screen.findByRole("combobox", { name: "Chủ sở hữu mới" }, SLOW);
  fireEvent.click(combobox);
  const option = await screen.findByRole("option", { name: "Nguyễn Văn An an@acme.vn" }, SLOW);
  // A pointer down first makes the click a real press (see the invite wizard tests).
  fireEvent.pointerDown(option);
  fireEvent.click(option);
  await waitFor(() => expect(combobox).toHaveTextContent("Nguyễn Văn An"));
}

/** Everything the transfer needs, then the press. */
async function fillAndSubmit() {
  renderDialog();
  await pickHeir();
  fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

async function prove(password = "password123") {
  const proof = await proofDialog();
  fireEvent.change(await proof.findByLabelText("Mật khẩu hiện tại", {}, SLOW), { target: { value: password } });
  fireEvent.click(proof.getByRole("button", { name: "Xác nhận" }));
  return proof;
}

describe("TransferOwnershipDialog", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it("stays disabled until the new owner and the exact organization name are both given, and asks for no password", () => {
    renderDialog();
    const submit = submitButton();
    // aria-disabled, not disabled: it stays in the tab order.
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
    // Who the owner is, is the proof dialog's to ask.
    expect(screen.queryByLabelText(/mật khẩu/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
    // Still inert: no new owner has been chosen.
    expect(submit).toHaveAttribute("aria-disabled", "true");
  });

  it("refuses a name that only nearly matches, and says so beside the field", () => {
    renderDialog();
    const field = screen.getByLabelText("Gõ tên tổ chức để xác nhận");
    fireEvent.change(field, { target: { value: "acme" } });
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/Chưa khớp với "Acme"/);
  });

  it("stays quiet while a correct prefix is being typed", () => {
    renderDialog();
    const field = screen.getByLabelText("Gõ tên tổ chức để xác nhận");
    fireEvent.change(field, { target: { value: "Ac" } });
    expect(field).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(field);
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("matches a name typed in decomposed Unicode (NFD) against the composed one", () => {
    const composed = "Công ty Ánh Dương".normalize("NFC");
    renderDialog(composed);
    const field = screen.getByLabelText("Gõ tên tổ chức để xác nhận");
    fireEvent.change(field, { target: { value: ` ${composed.normalize("NFD")} ` } });
    fireEvent.blur(field);
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/Chưa khớp/)).not.toBeInTheDocument();
  });

  it("forgets what was typed when it is cancelled", async () => {
    let open = true;
    const onOpenChange = (next: boolean) => {
      open = next;
    };
    const view = renderDialog("Acme", onOpenChange);
    fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(open).toBe(false);
    view.rerender(wrapWithNav(dialog(false, "Acme", onOpenChange)));
    view.rerender(wrapWithNav(dialog(true, "Acme", onOpenChange)));
    expect(await screen.findByLabelText("Gõ tên tổ chức để xác nhận")).toHaveValue("");
  });

  it("says what is still missing on the action it holds back", async () => {
    renderDialog();
    expect(submitButton()).toHaveAccessibleDescription("Chọn chủ sở hữu mới để tiếp tục.");
    expect(screen.getByText("Chọn chủ sở hữu mới để tiếp tục.")).toBeVisible();
    await pickHeir();
    expect(submitButton()).toHaveAccessibleDescription("Gõ đúng tên tổ chức để tiếp tục.");
    fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
    expect(submitButton()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText("Gõ đúng tên tổ chức để tiếp tục.")).not.toBeInTheDocument();
  });

  it("asks who the owner is, then hands the organization over with the token that proof bought", async () => {
    route({
      "POST /api/v1/me/step-up": (body: Record<string, unknown> | undefined) =>
        body?.password === "password123" ? grant("sut-1") : Promise.reject(new ApiError("x", "password_incorrect", 403)),
      [TRANSFER]: { member: { user_id: "u2", email: "an@acme.vn", display_name: "Nguyễn Văn An", role: "owner", created_at: "" } },
    });
    let open = true;
    render(wrapWithNav(dialog(true, "Acme", (next) => (open = next))));
    await pickHeir();
    fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
    fireEvent.click(submitButton());

    const proof = await proofDialog();
    expect(proof.getByText("Để bảo vệ tài khoản, xác nhận là bạn trước khi chuyển quyền sở hữu.")).toBeInTheDocument();
    // A wrong password is answered where it was typed; nothing is handed over.
    await prove("nope");
    expect(await proof.findByText("Mật khẩu chưa đúng. Nhập lại.", {}, SLOW)).toBeInTheDocument();
    expect(bodiesOf(TRANSFER)).toHaveLength(0);

    await prove();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã chuyển quyền sở hữu"), SLOW);
    expect(bodiesOf(TRANSFER)).toEqual([{ to_user_id: "u2", step_up_token: "sut-1" }]);
    expect(open).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("lets an owner without a password prove it with a code mailed for the hand-over", async () => {
    setSessionUser({ ...user, has_password: false });
    route({
      "GET /api/v1/me/sign-in-methods": { ...METHODS, password: { set: false, changed_at: null }, proofs: ["email_code"] },
      "POST /api/v1/me/step-up/email-code": { status: "sent" },
      "POST /api/v1/me/step-up": grant("sut-mail", "email_code"),
      [TRANSFER]: { member: null },
    });
    await fillAndSubmit();
    const proof = await proofDialog();
    fireEvent.click(await proof.findByRole("button", { name: "Gửi mã tới ha@acme.vn" }, SLOW));
    fireEvent.change(await proof.findByLabelText("Mã trong email", {}, SLOW), { target: { value: "123456" } });
    // The sixth digit sends it.
    await waitFor(() => expect(bodiesOf(TRANSFER)).toEqual([{ to_user_id: "u2", step_up_token: "sut-mail" }]), SLOW);
    expect(bodiesOf("POST /api/v1/me/step-up/email-code")).toEqual([{ action: "transfer_ownership" }]);
  });

  it("asks again, on the proofs the server names, when the held token no longer serves", async () => {
    let tokens = 0;
    let transfers = 0;
    route({
      "POST /api/v1/me/step-up": () => grant(`sut-${++tokens}`),
      [TRANSFER]: () =>
        transfers++ === 0
          ? Promise.reject(new ApiError("x", "proof_required", 403, undefined, { proofs: ["password"] }))
          : { member: null },
    });
    await fillAndSubmit();
    await prove();
    const again = await proofDialog();
    // The server named the password alone: no other way is offered.
    expect(again.queryByRole("button", { name: "Dùng cách khác" })).toBeNull();
    await prove();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã chuyển quyền sở hữu"), SLOW);
    expect(bodiesOf(TRANSFER)).toEqual([
      { to_user_id: "u2", step_up_token: "sut-1" },
      { to_user_id: "u2", step_up_token: "sut-2" },
    ]);
  });

  it("hands over nothing when the proof dialog is closed, and keeps what was chosen", async () => {
    route({});
    await fillAndSubmit();
    fireEvent.click((await proofDialog()).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Xác nhận là bạn" })).not.toBeInTheDocument());
    expect(bodiesOf(TRANSFER)).toHaveLength(0);
    expect(screen.getByLabelText("Gõ tên tổ chức để xác nhận")).toHaveValue("Acme");
    expect(submitButton()).not.toHaveAttribute("aria-disabled");
  });

  it("says any other refusal in a toast and hands nothing over", async () => {
    route({
      "POST /api/v1/me/step-up": grant("sut-1"),
      [TRANSFER]: () => Promise.reject(new ApiError("x", "forbidden", 403)),
    });
    await fillAndSubmit();
    await prove();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1), SLOW);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("dims the page harder, as every irreversible dialog does, and keeps one marker per consequence", () => {
    renderDialog();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass("bg-black/45");
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Không có gì bị xóa, nhưng tổ chức không còn do bạn nắm.",
    );
    expect(screen.getByRole("note").querySelector("svg")).toBeNull();
  });
});
