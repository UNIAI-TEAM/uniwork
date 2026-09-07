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

function renderDialog() {
  render(
    wrap(
      <TransferOwnershipDialog
        orgSlug="acme"
        organizationName="Acme"
        candidates={candidates}
        open
        onOpenChange={() => {}}
      />,
    ),
  );
}

describe("TransferOwnershipDialog", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("stays disabled until the new owner, the exact organization name and the password are all given", () => {
    renderDialog();
    const submit = screen.getByRole("button", { name: "Chuyển quyền" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "pw" } });
    // Still disabled: no new owner has been chosen.
    expect(submit).toBeDisabled();
  });

  it("refuses a name that only nearly matches", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "pw" } });
    expect(screen.getByRole("button", { name: "Chuyển quyền" })).toBeDisabled();
  });

  it("never puts the password in the request URL", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "secret" } });
    for (const [path] of requestMock.mock.calls) {
      expect(String(path)).not.toContain("secret");
    }
  });
});
