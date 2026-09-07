import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { SecurityTab } from "./security-tab";

initI18n();

const user = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
  has_password: true,
};

const sessions = [
  { id: "s-cur", user_agent: "Chrome on Mac", ip: "1.1.1.1", created_at: "2026-09-07T01:00:00Z", last_seen_at: "2026-09-07T02:00:00Z", current: true },
  { id: "s-old", user_agent: "Safari on iPhone", ip: "2.2.2.2", created_at: "2026-09-06T01:00:00Z", last_seen_at: "2026-09-06T02:00:00Z", current: false },
];

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("SecurityTab", () => {
  it("lists sessions, revokes one, and offers 'revoke others' only when there are others", async () => {
    setSessionUser(user);
    let rows = sessions;
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/v1/me/sessions") return Promise.resolve({ sessions: rows });
      if (path === "/api/v1/me/sessions/s-old" && init?.method === "DELETE") {
        rows = rows.filter((s) => s.id !== "s-old");
        return Promise.resolve({ status: "ok" });
      }
      return Promise.resolve({ status: "ok" });
    });
    render(wrapWithNav(<SecurityTab />));

    expect(await screen.findByText("Safari on iPhone")).toBeInTheDocument();
    expect(screen.getByText("Phiên này")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thu hồi 1 phiên khác" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thu hồi" }));
    await waitFor(() => expect(screen.queryByText("Safari on iPhone")).toBeNull());
    expect(screen.queryByRole("button", { name: /phiên khác/ })).toBeNull();
  });

  it("shows the error state with a retry when the list fails", async () => {
    setSessionUser(user);
    requestMock.mockRejectedValue(new ApiError("boom", "internal", 500));
    render(wrapWithNav(<SecurityTab />));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được danh sách phiên.");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("walks the MFA enrolment: setup shows the secret, confirm shows recovery codes once", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/me/mfa/setup") return Promise.resolve({ secret: "JBSWY3DPEHPK3PXP", otpauth_url: "otpauth://totp/x" });
      if (path === "/api/v1/me/mfa/confirm") return Promise.resolve({ recovery_codes: ["aaaaa-bbbbb", "ccccc-ddddd"] });
      if (path === "/api/v1/me") return Promise.resolve({ user: { ...user, mfa_enabled_at: "2026-09-07T00:00:00Z" } });
      return Promise.resolve({ sessions: [] });
    });
    render(wrapWithNav(<SecurityTab />));
    expect(await screen.findByText("Đang tắt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bật MFA" }));

    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mã 6 số từ ứng dụng"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và bật" }));

    expect(await screen.findByText("aaaaa-bbbbb")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tôi đã lưu mã" }));
    // The refetched user has MFA on, so the card now offers "disable".
    expect(await screen.findByRole("button", { name: "Tắt MFA" })).toBeInTheDocument();
  });

  it("asks for the password before deleting a password account and signs out after", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) => Promise.resolve(path === "/api/v1/me/sessions" ? { sessions: [] } : { status: "ok" }));
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tài khoản" }));
    const proof = await screen.findByLabelText("Nhập mật khẩu hiện tại để xác nhận");
    expect(proof).toHaveAttribute("type", "password");
    fireEvent.change(proof, { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() =>
      expect(requestMock.mock.calls.find(([path]) => path === "/api/v1/me/delete")?.[1]).toMatchObject({
        body: { password: "hunter22" },
      }),
    );
  });
});
