import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import type { Person } from "@uniwork/core/types/people";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ProfileEditDialog } from "./profile-edit-dialog";

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

const person = {
  user_id: "u1",
  display_name: "Đỗ Thị Hà",
  email: "ha@acme.vn",
  org_role: "owner",
  status: "active",
  title: "Trưởng nhóm",
  department: { id: "d1", name: "Kỹ thuật" },
  employee_code: "UNI-0142",
  phone: "0912 345 678",
  phone_visible: true,
  location: "Hà Nội",
  bio: "",
  joined_on: "2024-03-18",
  timezone: "Asia/Ho_Chi_Minh",
} as unknown as Person;

/** The membership row decides `canEditEmployment`; owner may edit everything. */
function mockApi(role: string, onPatch?: () => Promise<unknown>) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role });
    if (path.endsWith("/departments")) return Promise.resolve({ departments: [] });
    if (opts?.method === "PATCH" && onPatch) return onPatch();
    return Promise.resolve({ person });
  });
}

function renderForm(onDone = () => {}) {
  return render(
    wrapWithNav(
      <ProfileEditDialog
        orgSlug="acme"
        person={person}
        open
        onOpenChange={(next: boolean) => {
          if (!next) onDone();
        }}
      />,
    ),
  );
}

/** Everything the editor renders lives inside the dialog, never on the page. */
function dialog() {
  return screen.getByRole("dialog");
}

function saveButton() {
  return screen.getByRole("button", { name: "Lưu" });
}

describe("ProfileForm layout", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
    mockApi("owner");
  });

  it("edits inside a dialog, the way the meeting detail screen does", async () => {
    renderForm();
    const editor = await screen.findByRole("dialog");

    expect(within(editor).getByRole("heading", { name: "Sửa hồ sơ" })).toBeInTheDocument();
    expect(within(editor).getByLabelText("Chức danh")).toBeInTheDocument();
  });

  it("splits the fields into the personal group and the company group", async () => {
    renderForm();
    await screen.findByLabelText("Chức danh");

    expect(within(dialog()).getByRole("heading", { name: "Thông tin cá nhân" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("heading", { name: "Thông tin công ty" })).toBeInTheDocument();
  });

  it("explains every locked company field once, not just the department", async () => {
    requestMock.mockReset();
    mockApi("member");
    renderForm();
    await screen.findByLabelText("Mã nhân viên");

    expect(within(dialog()).getByLabelText("Mã nhân viên")).toBeDisabled();
    // One reason for the group, rather than a reason attached to one field
    // while its two locked neighbours say nothing.
    expect(within(dialog()).getAllByText(/quản trị/i).length).toBeGreaterThan(0);
  });
});

describe("ProfileForm unsaved changes", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
    mockApi("owner");
  });

  it("keeps Save inactive until something actually changes", async () => {
    renderForm();
    await screen.findByLabelText("Chức danh");

    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByLabelText("Nơi làm việc"), { target: { value: "Đà Nẵng" } });
    expect(saveButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("closes straight away when Cancel is pressed on an untouched form", async () => {
    let done = false;
    renderForm(() => {
      done = true;
    });
    await screen.findByLabelText("Chức danh");

    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(done).toBe(true);
  });

  it("asks before throwing away edits when Escape closes the dialog", async () => {
    let done = false;
    renderForm(() => {
      done = true;
    });
    await screen.findByLabelText("Chức danh");

    fireEvent.change(screen.getByLabelText("Nơi làm việc"), { target: { value: "Đà Nẵng" } });
    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(done).toBe(false);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("asks before throwing away edits when Cancel is pressed", async () => {
    let done = false;
    renderForm(() => {
      done = true;
    });
    await screen.findByLabelText("Chức danh");

    fireEvent.change(screen.getByLabelText("Nơi làm việc"), { target: { value: "Đà Nẵng" } });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(done).toBe(false);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Bỏ thay đổi" }));
    await waitFor(() => expect(done).toBe(true));
  });
});

describe("ProfileForm validation", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("counts the bio down and refuses to save past the limit", async () => {
    mockApi("owner");
    renderForm();
    const bio = await screen.findByLabelText("Giới thiệu");

    fireEvent.change(bio, { target: { value: "xin chào" } });
    expect(screen.getByText("8/500")).toBeInTheDocument();

    fireEvent.change(bio, { target: { value: "x".repeat(501) } });
    expect(await screen.findByText("Giới thiệu tối đa 500 ký tự.")).toBeInTheDocument();
    expect(bio).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("puts a rejected employee code on its own field, not only in a toast", async () => {
    mockApi("owner", () =>
      Promise.reject(
        new ApiError("mã nhân viên đã được dùng trong tổ chức", "employee_code_taken", 409),
      ),
    );
    renderForm();
    const code = await screen.findByLabelText("Mã nhân viên");

    fireEvent.change(code, { target: { value: "UNI-0001" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(code).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("mã nhân viên đã được dùng trong tổ chức")).toBeInTheDocument();
    expect(code).toHaveFocus();
  });
});
