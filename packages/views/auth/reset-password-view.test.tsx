import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { forgetLinkReset, rememberLinkReset, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { ResetPasswordView } from "./reset-password-view";

initI18n();

const user = { id: "u1", email: "a@b.c", display_name: "A" };

function fillMatchingPasswords() {
  fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpassword1" } });
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "newpassword1" } });
}

/** The reset itself; the page also asks whether a Google or Apple sign-in waits to be linked. */
const resetCalls = () => requestMock.mock.calls.filter(([path]) => path === "/api/v1/auth/password/reset");

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("ResetPasswordView", () => {
  it("blocks submit when passwords differ and shows invalid token error", async () => {
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpassword1" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "newpassword2" } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(screen.getByText("Hai mật khẩu chưa khớp")).toBeInTheDocument();
    expect(resetCalls()).toHaveLength(0);
    // Editing either field clears the stale message.
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "newpassword1" } });
    expect(screen.queryByText("Hai mật khẩu chưa khớp")).not.toBeInTheDocument();
  });

  it("rejects a short password before calling the server", () => {
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(screen.getByText("Mật khẩu cần ít nhất 8 ký tự")).toBeInTheDocument();
    expect(resetCalls()).toHaveLength(0);
  });

  it("shows the invalid-token state with a link back to forgot-password on invalid_token", async () => {
    requestMock.mockRejectedValue(new ApiError("bad token", "invalid_token", 400));
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(await screen.findByText("Link đã hết hạn hoặc đã được dùng.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Yêu cầu link mới" })).toHaveAttribute("href", "/forgot-password");
  });

  it("hands the new session to onSuccess when the passwords match", async () => {
    requestMock.mockResolvedValue({ user, access_token: "tok-9" });
    const onSuccess = vi.fn();
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={onSuccess} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ access_token: "tok-9", user: expect.objectContaining(user) }),
    );
  });
});

describe("ResetPasswordView with a pending link (spec §4.4)", () => {
  const TICKET = { provider: "apple", kind: "unmatched", email: "x@icloud.com", name: "", private_relay: false };
  const route = (reset: unknown, ticket: () => Promise<unknown> = async () => TICKET) =>
    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/auth/sign-in-ticket") return opts?.method === "DELETE" ? undefined : ticket();
      if (path === "/api/v1/auth/password/reset") return reset;
      throw new Error(`unexpected ${path}`);
    });
  const discards = () =>
    requestMock.mock.calls.filter(([path, opts]) => path === "/api/v1/auth/sign-in-ticket" && (opts as { method?: string })?.method === "DELETE");

  beforeEach(() => forgetLinkReset());

  it("keeps the pending sign-in of the person who asked in link mode, and goes to the link step", async () => {
    // "Quên mật khẩu?" on /login?link=1 sent the reset to this address.
    rememberLinkReset("A@b.c");
    route({ user, access_token: "tok-9" });
    const onSuccess = vi.fn();
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={onSuccess} />));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/auth/sign-in-ticket", expect.anything()));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(resetCalls()[0]![1]).toMatchObject({ body: { token: "t", password: "newpassword1", keep_sign_in_ticket: true } });
    expect(onSuccess.mock.calls[0]![1]).toBe("/auth/continue?step=link");
    expect(discards()).toHaveLength(0);
  });

  it("never adopts a sign-in someone else left waiting in this browser", async () => {
    route({ user, access_token: "tok-9" });
    const onSuccess = vi.fn();
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={onSuccess} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect((resetCalls()[0]![1] as { body: object }).body).not.toHaveProperty("keep_sign_in_ticket");
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/auth/sign-in-ticket", expect.anything());
    expect(onSuccess.mock.calls[0]![1]).toBeNull();
  });

  it("drops the pending sign-in when the reset opened another address than the one asked for", async () => {
    rememberLinkReset("someone@else.vn");
    route({ user, access_token: "tok-9" });
    const onSuccess = vi.fn();
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={onSuccess} />));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/auth/sign-in-ticket", expect.anything()));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess.mock.calls[0]![1]).toBeNull();
    await waitFor(() => expect(discards()).toHaveLength(1));
  });

  it("waits for the pending sign-in's answer before it sends the reset", async () => {
    rememberLinkReset("a@b.c");
    let answer: (v: unknown) => void = () => {};
    route({ user, access_token: "tok-9" }, () => new Promise((r) => (answer = r)));
    const onSuccess = vi.fn();
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={onSuccess} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(await screen.findByRole("button", { name: /Đang/ })).toHaveAttribute("aria-disabled", "true");
    expect(resetCalls()).toHaveLength(0);
    answer(TICKET);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(resetCalls()).toHaveLength(1);
    expect(resetCalls()[0]![1]).toMatchObject({ body: { keep_sign_in_ticket: true } });
  });

  it("finishes a second factor on /login, still linking", async () => {
    rememberLinkReset("a@b.c");
    route({ mfa_required: true, mfa_token: "" });
    const nav = fakeNav("/reset-password?token=t");
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />, nav));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/auth/sign-in-ticket", expect.anything()));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith(`/login?mfa=1&reset=1&next=${encodeURIComponent("/auth/continue?step=link")}&link=1`),
    );
  });

  it("does not keep anything when no sign-in waits", async () => {
    rememberLinkReset("a@b.c");
    route({ user, access_token: "tok-9" }, () => Promise.reject(new ApiError("gone", "sign_in_ticket_missing", 404)));
    const onSuccess = vi.fn();
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={onSuccess} />));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/auth/sign-in-ticket", expect.anything()));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(resetCalls()[0]![1]).toMatchObject({ body: { token: "t", password: "newpassword1" } });
    expect((resetCalls()[0]![1] as { body: object }).body).not.toHaveProperty("keep_sign_in_ticket");
    expect(onSuccess.mock.calls[0]![1]).toBeNull();
  });
});

describe("ResetPasswordView focus", () => {
  it("moves focus to the field that owns the error", () => {
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpassword1" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(screen.getByLabelText("Nhập lại mật khẩu")).toHaveFocus();
  });

  it("moves focus to the heading when the token turns out invalid", async () => {
    requestMock.mockRejectedValue(new ApiError("bad token", "invalid_token", 400));
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Link không còn hiệu lực" })).toHaveFocus();
  });
});
