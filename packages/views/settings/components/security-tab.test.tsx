import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

const sessions = [
  { id: "s-cur", user_agent: MAC_CHROME, ip: "::1", created_at: "2026-09-07T01:00:00Z", last_seen_at: "2026-09-07T02:00:00Z", current: true },
  { id: "s-old", user_agent: IPHONE_SAFARI, ip: "2.2.2.2", created_at: "2026-09-06T01:00:00Z", last_seen_at: "2026-09-06T02:00:00Z", current: false },
  { id: "s-win", user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0", ip: "3.3.3.3", created_at: "", last_seen_at: "", current: false },
];

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("SecurityTab", () => {
  it("names sessions by browser and system, and revokes one only after confirming", async () => {
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

    expect(await screen.findByText("Safari trên iOS")).toBeInTheDocument();
    expect(screen.getByText("Chrome trên macOS")).toBeInTheDocument();
    expect(screen.queryByText(/Mozilla/)).toBeNull();
    // Loopback reads as this machine, not a bare "::1".
    expect(screen.getByText(/^Máy cục bộ \(localhost\)/)).toBeInTheDocument();
    expect(screen.getByText("Phiên này")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thu hồi 2 phiên khác" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thu hồi Safari trên iOS" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Thu hồi phiên Safari trên iOS?");
    expect(requestMock.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === "DELETE")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Thu hồi" }));
    await waitFor(() => expect(screen.queryByText("Safari trên iOS")).toBeNull());
    expect(screen.getByRole("button", { name: "Thu hồi 1 phiên khác" })).toBeInTheDocument();
  });

  it("confirms before revoking every other session", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/me/sessions" ? { sessions } : { status: "ok" }),
    );
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Thu hồi 2 phiên khác" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Thu hồi 2 phiên khác?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/me/sessions/revoke-others")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Thu hồi 2 phiên khác" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Thu hồi 2 phiên khác" }));
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/me/sessions/revoke-others")).toBe(true),
    );
  });

  it("shows the error state with a retry when the list fails", async () => {
    setSessionUser(user);
    requestMock.mockRejectedValue(new ApiError("boom", "internal", 500));
    render(wrapWithNav(<SecurityTab />));
    expect(await screen.findByText("Không tải được danh sách phiên.")).toBeInTheDocument();
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
    // Confirming turned MFA on; the badge says so before the codes are dismissed.
    expect(screen.getByText("Đang bật")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sao chép" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải về (.txt)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tôi đã lưu mã" }));
    // The refetched user has MFA on, so the card now offers "disable".
    expect(await screen.findByRole("button", { name: "Tắt MFA" })).toBeInTheDocument();
  });

  it("refuses a short or wrong enrolment code under the field and puts focus back there", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/me/mfa/setup") return Promise.resolve({ secret: "JBSWY3DPEHPK3PXP", otpauth_url: "otpauth://totp/x" });
      if (path === "/api/v1/me/mfa/confirm") return Promise.reject(new ApiError("Mã không khớp.", "invalid_code", 400));
      return Promise.resolve({ sessions: [] });
    });
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Bật MFA" }));
    const input = await screen.findByLabelText("Mã 6 số từ ứng dụng");

    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và bật" }));
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Nhập đủ 6 chữ số ứng dụng hiện ra.");
    expect(input).toHaveFocus();
    expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/me/mfa/confirm")).toBe(false);

    fireEvent.change(input, { target: { value: "123456" } });
    expect(input).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và bật" }));
    await waitFor(() => expect(input).toHaveAccessibleDescription("Mã không khớp."));
    expect(input).toHaveFocus();
  });

  it("labels the disable-MFA field visibly, keeps a text keyboard for recovery codes, and refuses inline", async () => {
    setSessionUser({ ...user, mfa_enabled_at: "2026-09-07T00:00:00Z" });
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/me/mfa/disable"
        ? Promise.reject(new ApiError("Mã không đúng.", "invalid_code", 400))
        : Promise.resolve({ sessions: [] }),
    );
    render(wrapWithNav(<SecurityTab />));
    const input = await screen.findByLabelText("Mã xác thực");
    expect(input).not.toHaveAttribute("inputmode", "numeric");
    expect(input).not.toHaveAttribute("placeholder");

    fireEvent.click(screen.getByRole("button", { name: "Tắt MFA" }));
    expect(input).toHaveAccessibleDescription(/Nhập mã từ ứng dụng hoặc một mã khôi phục\./);
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "abcde-12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Tắt MFA" }));
    await waitFor(() => expect(input).toHaveAccessibleDescription(/Mã không đúng\./));
  });

  it("keeps a refused account deletion under the proof field, not in a toast", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/me/delete"
        ? Promise.reject(new ApiError("Mật khẩu không đúng.", "invalid_password", 400))
        : Promise.resolve({ sessions: [] }),
    );
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tài khoản" }));
    const proof = await screen.findByLabelText("Nhập mật khẩu hiện tại để xác nhận");

    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn" }));
    expect(proof).toHaveAttribute("aria-invalid", "true");
    expect(proof).toHaveAccessibleDescription(/^Nhập mật khẩu để xác nhận\./);
    expect(proof).toHaveFocus();

    fireEvent.change(proof, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() => expect(proof).toHaveAccessibleDescription(/^Mật khẩu không đúng\./));
    expect(proof).toHaveFocus();
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
