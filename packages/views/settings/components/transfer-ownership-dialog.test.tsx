import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import type { OrgMember } from "@uniwork/core/types/people";
import { requestMock, wrap } from "../../test/api-mock";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";

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

describe("TransferOwnershipDialog", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
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
    expect(field).toHaveAccessibleDescription(/Chưa khớp với “Acme”/);
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
});
