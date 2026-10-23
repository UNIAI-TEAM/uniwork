import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import type { OrgMember } from "@uniwork/core/types/people";
import { requestMock, wrap } from "../../test/api-mock";
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
  return render(wrap(dialog(true, organizationName, onOpenChange)));
}

const submitButton = () => screen.getByRole("button", { name: "Chuyển quyền" });

const SLOW = { timeout: 3000 };

async function pickHeir() {
  const combobox = await screen.findByRole("combobox", { name: "Chủ sở hữu mới" }, SLOW);
  fireEvent.click(combobox);
  const option = await screen.findByRole("option", { name: "Nguyễn Văn An an@acme.vn" }, SLOW);
  // A pointer down first makes the click a real press (see the invite wizard tests).
  fireEvent.pointerDown(option);
  fireEvent.click(option);
  await waitFor(() => expect(combobox).toHaveTextContent("Nguyễn Văn An"));
}

/** Everything the transfer needs, then the press; the server answers with `refusal`. */
async function submitRefusedWith(refusal: ApiError) {
  requestMock.mockImplementation((path: string) =>
    path.endsWith("/transfer-ownership") ? Promise.reject(refusal) : Promise.resolve({}),
  );
  renderDialog();
  await pickHeir();
  fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
  fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "wrong" } });
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

describe("TransferOwnershipDialog", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("stays disabled until the new owner, the exact organization name and the password are all given", () => {
    renderDialog();
    const submit = submitButton();
    // aria-disabled, not disabled: it stays in the tab order.
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "pw" } });
    // Still inert: no new owner has been chosen.
    expect(submit).toHaveAttribute("aria-disabled", "true");
  });

  it("refuses a name that only nearly matches, and says so beside the field", () => {
    renderDialog();
    const field = screen.getByLabelText("Gõ tên tổ chức để xác nhận");
    fireEvent.change(field, { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "pw" } });
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
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(open).toBe(false);
    view.rerender(wrap(dialog(false, "Acme", onOpenChange)));
    view.rerender(wrap(dialog(true, "Acme", onOpenChange)));
    expect(await screen.findByLabelText("Mật khẩu hiện tại của bạn")).toHaveValue("");
    expect(screen.getByLabelText("Gõ tên tổ chức để xác nhận")).toHaveValue("");
  });

  it("never puts the password in the request URL", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "secret" } });
    for (const [path] of requestMock.mock.calls) {
      expect(String(path)).not.toContain("secret");
    }
  });

  it("says what is still missing on the action it holds back", async () => {
    renderDialog();
    expect(submitButton()).toHaveAccessibleDescription("Chọn chủ sở hữu mới để tiếp tục.");
    expect(screen.getByText("Chọn chủ sở hữu mới để tiếp tục.")).toBeVisible();
    await pickHeir();
    expect(submitButton()).toHaveAccessibleDescription("Gõ đúng tên tổ chức để tiếp tục.");
    fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
    expect(submitButton()).toHaveAccessibleDescription("Nhập mật khẩu hiện tại để tiếp tục.");
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "pw" } });
    expect(submitButton()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText("Nhập mật khẩu hiện tại để tiếp tục.")).not.toBeInTheDocument();
  });

  it("sends the owner back to the password, emptied and focused, when the server refuses it", async () => {
    await submitRefusedWith(new ApiError("mật khẩu không đúng", "password_incorrect", 403));
    const password = await screen.findByLabelText("Mật khẩu hiện tại của bạn", {}, SLOW);
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    expect(password).toHaveValue("");
    expect(password).toHaveAccessibleDescription("Mật khẩu chưa đúng. Nhập lại để chuyển quyền sở hữu.");
    await waitFor(() => expect(password).toHaveFocus());
    // Inline, not also a toast, and never the server's sentence.
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText("mật khẩu không đúng")).not.toBeInTheDocument();
    // Typing again clears the refusal.
    fireEvent.change(password, { target: { value: "p" } });
    expect(password).not.toHaveAttribute("aria-invalid");
  });

  it("reads an older server's 401 invalid_credentials the same way", async () => {
    await submitRefusedWith(new ApiError("x", "invalid_credentials", 401));
    const password = await screen.findByLabelText("Mật khẩu hiện tại của bạn", {}, SLOW);
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
  });

  it("says the account has no password when the server refuses the transfer for that", async () => {
    await submitRefusedWith(new ApiError("x", "password_required", 403));
    expect(await screen.findByText(/tài khoản của bạn chưa có mật khẩu/, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mật khẩu hiện tại của bạn")).not.toBeInTheDocument();
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(submitButton()).toHaveAccessibleDescription("Chưa thể chuyển quyền khi tài khoản chưa có mật khẩu.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so up front for an account known to have no password", () => {
    setSessionUser({ ...user, has_password: false });
    renderDialog();
    expect(screen.getByText(/tài khoản của bạn chưa có mật khẩu/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mật khẩu hiện tại của bạn")).not.toBeInTheDocument();
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
