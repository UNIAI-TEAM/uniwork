import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { forgetLinkReset, linkResetIntent, rememberLinkReset, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { LoginView } from "./login-view";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

initI18n();

/**
 * /login?link=1 (spec §4.4): the choice screen's "Tôi đã có tài khoản UniWork".
 * The banner names the waiting provider, its own button goes, and every way in
 * keeps the pending sign-in and `next` (the link step).
 */
const NEXT = "/invite/t1";
const LINK_STEP = `/auth/continue?step=link&next=${encodeURIComponent(NEXT)}`;
const TICKET = { provider: "google", kind: "unmatched", email: "an@gmail.com", name: "An", private_relay: false };
const SESSION = { access_token: "tok", user: { id: "u1", email: "an@company.vn", display_name: "An" } };
const PROVIDERS = { google: true, apple: true, apple_web: true, google_native: false };

type Answer = unknown | ((body: unknown) => unknown);
function route(map: Record<string, Answer>) {
  requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    const key = `${opts?.method ?? "GET"} ${path}`;
    if (!(key in map)) throw new Error(`unexpected ${key}`);
    const answer = map[key];
    return typeof answer === "function" ? (answer as (body: unknown) => unknown)(opts?.body) : answer;
  });
}
const sent = (path: string) => requestMock.mock.calls.find(([p]) => p === path)?.[1] as { body?: unknown } | undefined;

function open(props: { initialMfa?: boolean; fromReset?: boolean } = {}) {
  const nav = fakeNav(`/login?next=${encodeURIComponent(LINK_STEP)}&link=1`);
  const onSuccess = vi.fn();
  render(
    wrapWithNav(
      <LoginView next={LINK_STEP} link onSuccess={onSuccess} initialMfa={props.initialMfa} fromReset={props.fromReset} />,
      nav,
    ),
  );
  return { nav, onSuccess };
}

function fill(email = "an@company.vn") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "hunter22" } });
}

beforeEach(() => {
  requestMock.mockReset();
  toastMock.warning.mockReset();
  resetAuthStoreForTests();
  resetRuntimeConfig();
  configureRuntime({ apiUrl: "http://api.test" });
});

describe("LoginView link mode", () => {
  it("names the waiting provider, leaves its own button out and keeps next on every other way in", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET, "GET /api/v1/auth/providers": PROVIDERS });
    open();
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("Đăng nhập vào tài khoản UniWork của bạn để liên kết Google (an@gmail.com).");
    const group = await screen.findByRole("group", { name: "Đăng nhập bằng Google hoặc Apple" });
    const links = within(group).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Tiếp tục với Apple"]);
    expect(links[0]).toHaveAttribute("href", `http://api.test/api/v1/auth/apple/start?next=${encodeURIComponent(LINK_STEP)}`);
    expect(screen.getByRole("link", { name: "Quên mật khẩu?" })).toHaveAttribute(
      "href",
      `/forgot-password?next=${encodeURIComponent(LINK_STEP)}`,
    );
    // Registering drops the pending sign-in, so it goes on to the link step's own next.
    expect(screen.getByRole("link", { name: "Đăng ký" })).toHaveAttribute("href", `/register?next=${encodeURIComponent(NEXT)}`);
  });

  it("keeps the pending sign-in through the password and the second factor, and says which provider", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/auth/login": { mfa_required: true, mfa_token: "chal" },
      "POST /api/v1/auth/mfa/verify": { ...SESSION, link_skipped: "sign_in_method_taken" },
    });
    const { onSuccess } = open();
    await screen.findByRole("note");
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    expect(await screen.findByText("Đăng nhập vào an@company.vn để liên kết Google.")).toBeInTheDocument();
    expect(sent("/api/v1/auth/login")?.body).toMatchObject({ keep_sign_in_ticket: true });
    fireEvent.change(screen.getByLabelText("Mã xác thực"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(sent("/api/v1/auth/mfa/verify")?.body).toMatchObject({ mfa_token: "chal", keep_sign_in_ticket: true });
    expect(toastMock.warning).toHaveBeenCalledWith(
      "Bạn đã đăng nhập, nhưng chưa liên kết được Google. Thử lại trong Cài đặt › Bảo mật.",
      expect.anything(),
    );
  });

  it("names only the provider on a second factor that came in a cookie (a reset)", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET, "GET /api/v1/auth/providers": PROVIDERS });
    open({ initialMfa: true });
    expect(await screen.findByText("Đăng nhập vào tài khoản UniWork của bạn để liên kết Google.")).toBeInTheDocument();
  });

  // A reset in link mode whose account has a second factor (spec §4.4): the
  // code comes here, and the account it opens is checked against the reset
  // this browser asked for, as the reset page checks it without one.
  async function finishResetFactor(intentFor: string) {
    forgetLinkReset();
    rememberLinkReset(intentFor);
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/auth/mfa/verify": SESSION,
      "DELETE /api/v1/auth/sign-in-ticket": undefined,
    });
    const opened = open({ initialMfa: true, fromReset: true });
    fireEvent.change(await screen.findByLabelText("Mã xác thực"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(opened.onSuccess).toHaveBeenCalled());
    return opened;
  }

  it("goes on to link after a reset's second factor when the reset was asked for this account", async () => {
    const { onSuccess } = await finishResetFactor("An@Company.vn");
    expect(onSuccess.mock.calls[0]).toHaveLength(1);
    expect(requestMock.mock.calls.some(([, o]) => (o as { method?: string } | undefined)?.method === "DELETE")).toBe(false);
    expect(linkResetIntent()).toBeNull();
  });

  it("drops the pending sign-in when a reset's second factor opened another account than the one asked for", async () => {
    const { onSuccess } = await finishResetFactor("x@company.vn");
    await waitFor(() =>
      expect(requestMock.mock.calls.filter(([p, o]) => p === "/api/v1/auth/sign-in-ticket" && (o as { method?: string })?.method === "DELETE")).toHaveLength(1),
    );
    // On past the link step, to where the person was going.
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: "u1" }) }), NEXT);
    expect(linkResetIntent()).toBeNull();
  });

  it("says the other way matched no account, the waiting sign-in still named", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET, "GET /api/v1/auth/providers": PROVIDERS });
    const onSuccess = vi.fn();
    render(
      wrapWithNav(
        <LoginView next={LINK_STEP} link redirectError="apple_no_account" onSuccess={onSuccess} />,
        fakeNav(`/login?error=apple_no_account&next=${encodeURIComponent(LINK_STEP)}`),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Chưa có tài khoản UniWork nào đăng nhập bằng tài khoản Apple này. Đăng nhập bằng cách bạn vẫn dùng.",
    );
    expect(await screen.findByRole("note")).toHaveTextContent("Google");
  });

  it("drops the pending sign-in and the link mode on Không liên kết", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "GET /api/v1/auth/providers": PROVIDERS,
      "DELETE /api/v1/auth/sign-in-ticket": undefined,
    });
    const { nav } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Không liên kết" }));
    expect(nav.replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(NEXT)}`);
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, opts]) => path === "/api/v1/auth/sign-in-ticket" && (opts as { method?: string })?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });

  it("fills in the address that already has the account and moves on to the password", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": { ...TICKET, kind: "link_required", email: "an@company.vn" },
      "GET /api/v1/auth/providers": PROVIDERS,
    });
    open();
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("an@company.vn"));
    expect(screen.getByLabelText("Mật khẩu")).toHaveFocus();
  });

  it("is a plain sign-in once the pending sign-in is gone", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": () => Promise.reject(new ApiError("gone", "sign_in_ticket_missing", 404)),
      "GET /api/v1/auth/providers": PROVIDERS,
    });
    open();
    const group = await screen.findByRole("group", { name: "Đăng nhập bằng Google hoặc Apple" });
    expect(within(group).getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
