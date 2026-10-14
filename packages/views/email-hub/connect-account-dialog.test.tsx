import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { requestMock, wrap } from "../test/api-mock";
import { ConnectAccountDialog } from "./connect-account-dialog";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, info: toastInfo, error: vi.fn() } }));

const accountJSON = {
  id: "acc1",
  email_address: "ha.do@unicomhub.com",
  provider: "gmail",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: false,
  auth_failed_reason: "",
};

const customJSON = {
  id: "acc2",
  email_address: "lan@unicomhub.vn",
  provider: "custom",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: true,
  auth_failed_reason: "imap_auth_failed",
  imap_host: "imap.unicomhub.vn",
  imap_port: 993,
  imap_security: "tls",
  smtp_host: "smtp.unicomhub.vn",
  smtp_port: 465,
  smtp_security: "tls",
  username: "",
};

const microsoftJSON = {
  id: "acc3",
  email_address: "lan@contoso.vn",
  provider: "outlook",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "oauth_microsoft",
  needs_reconnect: true,
  auth_failed_reason: "oauth_invalid_grant",
};

const ACCOUNTS_PATH = "/api/v1/workspaces/ws1/email-hub/accounts";
const PROVIDERS_PATH = "/api/v1/workspaces/ws1/email-hub/providers";
const startPath = (provider: string) => `/api/v1/workspaces/ws1/email-hub/oauth/${provider}/start`;
const AUTH_URL = "https://login.example.test/authorize?state=s";
const NO_PROVIDERS = { google: false, microsoft: false };
const BOTH = { google: true, microsoft: true };

/** The dialog reads the account list (GET) and connects with a POST to the same path; OAuth reads providers and posts start. */
function serve(
  list: unknown,
  connect: () => Promise<unknown> = () => Promise.resolve(accountJSON),
  oauth: { providers?: unknown; start?: () => Promise<unknown> } = {},
) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === PROVIDERS_PATH) return Promise.resolve(oauth.providers ?? NO_PROVIDERS);
    if (path.endsWith("/start")) return oauth.start ? oauth.start() : Promise.resolve({ authorization_url: AUTH_URL });
    if (path !== ACCOUNTS_PATH) return Promise.resolve({});
    return opts?.method === "POST" ? connect() : Promise.resolve(list);
  });
}

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastInfo.mockReset();
  serve({ accounts: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const customOption = () => screen.getByRole("button", { name: /^Tên miền riêng \(IMAP\/SMTP\)/ });
const appPasswordOption = () => screen.getByRole("button", { name: /^Dùng App Password/ });
const googleOption = () => screen.queryByRole("button", { name: /^Đăng nhập bằng Google/ });
const microsoftOption = () => screen.queryByRole("button", { name: /^Đăng nhập bằng Microsoft/ });

function fillAndSubmit(email: string | null, submitName: string) {
  if (email !== null) fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
  fireEvent.click(screen.getByRole("button", { name: submitName }));
}

type FakePopup = { closed: boolean; close: () => void; focus: () => void; location: { href: string } };

/** window.open answers a fake popup; the dialog only points it at a URL or closes it. */
function fakePopup() {
  const popup: FakePopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    focus: vi.fn(),
    location: { href: "" },
  };
  const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  return { popup, open };
}

type RequestCall = [string, { method?: string; body?: { login_hint?: string } }?];
const calls = () => requestMock.mock.calls as RequestCall[];
const startCall = (provider: string) => calls().find(([path]) => path === startPath(provider));
const accountListReads = () => calls().filter(([path, opts]) => path === ACCOUNTS_PATH && opts?.method !== "POST").length;

/** What the callback page posts to its opener (spec §5.4), from the API origin and the popup the hook trusts. */
function postResult(popup: FakePopup, ok: boolean, code: string) {
  const event = new MessageEvent("message", {
    origin: new URL(runtimeConfig().apiUrl, window.location.href).origin,
    data: { type: "uniwork:email-hub-oauth", ok, code },
  });
  // jsdom refuses a non-Window MessageEventInit.source; the hook checks event.source === popup.
  Object.defineProperty(event, "source", { value: popup });
  act(() => {
    window.dispatchEvent(event);
  });
}

async function startGoogleSignIn(popup: FakePopup) {
  fireEvent.click(await screen.findByRole("button", { name: /^Đăng nhập bằng Google/ }));
  await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
}

describe("ConnectAccountDialog", () => {
  it("starts a new connect on the method step, opens the chosen form and goes back", () => {
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    expect(customOption()).toBeInTheDocument();
    expect(appPasswordOption()).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();

    fireEvent.click(customOption());
    expect(document.getElementById("email-hub-custom-form")).not.toBeNull();
    expect(screen.queryByLabelText("App Password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(document.getElementById("email-hub-custom-form")).toBeNull();

    fireEvent.click(appPasswordOption());
    expect(screen.getByLabelText("App Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hướng dẫn cho Gmail" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(screen.queryByLabelText("App Password")).not.toBeInTheDocument();
    expect(customOption()).toBeInTheDocument();
  });

  it("opens on the method step again after a close, with the password cleared", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    fireEvent.click(appPasswordOption());
    fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh" } });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(wrap(<ConnectAccountDialog wsId="ws1" open={false} onOpenChange={onOpenChange} />));
    rerender(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));

    expect(screen.queryByLabelText("App Password")).not.toBeInTheDocument();
    fireEvent.click(appPasswordOption());
    expect(screen.getByLabelText("App Password")).toHaveValue("");
  });

  it("reconnects a custom-server mailbox in its own form, prefilled except the password", async () => {
    serve({ accounts: [accountJSON, customJSON] }, () => Promise.resolve(customJSON));
    const onConnected = vi.fn();
    render(
      wrap(
        <ConnectAccountDialog
          wsId="ws1"
          open
          reconnectEmail="lan@unicomhub.vn"
          onOpenChange={() => {}}
          onConnected={onConnected}
        />,
      ),
    );

    expect(await screen.findByDisplayValue("imap.unicomhub.vn")).toBeInTheDocument();
    expect(screen.getByDisplayValue("smtp.unicomhub.vn")).toBeInTheDocument();
    expect(screen.getByText("Kết nối lại lan@unicomhub.vn")).toBeInTheDocument();
    expect(
      screen.getByText("Nhập lại mật khẩu hoặc sửa cài đặt máy chủ. Thư đã đồng bộ được giữ nguyên, trừ khi bạn đổi máy chủ IMAP."),
    ).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("lan@unicomhub.vn");
    expect(email).toHaveAttribute("readonly");
    const password = document.querySelector<HTMLInputElement>('input[type="password"]');
    expect(password).toHaveValue("");
    // A reconnect has no method to go back to.
    expect(screen.queryByRole("button", { name: "Quay lại" })).not.toBeInTheDocument();

    fireEvent.change(password!, { target: { value: "n3w pass" } });
    fireEvent.submit(document.getElementById("email-hub-custom-form")!);

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc2"));
    expect(requestMock).toHaveBeenCalledWith(ACCOUNTS_PATH, {
      method: "POST",
      body: expect.objectContaining({
        email_address: "lan@unicomhub.vn",
        app_password: "n3w pass",
        imap_host: "imap.unicomhub.vn",
        imap_port: 993,
        imap_security: "tls",
        smtp_host: "smtp.unicomhub.vn",
        smtp_port: 465,
        smtp_security: "tls",
      }),
    });
  });

  it.each([
    ["has loaded", () => Promise.resolve({ accounts: [accountJSON] }), false],
    ["is still loading", () => new Promise(() => {}), true],
  ])("reconnects a preset mailbox with the app-password form when the list %s", async (_, list, blocked) => {
    serve(list());
    render(wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail="ha.do@unicomhub.com" onOpenChange={() => {}} />));

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(ACCOUNTS_PATH));
    await act(async () => {});

    expect(screen.getByLabelText("App Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(document.getElementById("email-hub-custom-form")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tên miền riêng/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quay lại" })).not.toBeInTheDocument();

    // Until the list says the mailbox is not custom, the app-password form must not submit.
    fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh" } });
    const submit = screen.getByRole("button", { name: "Kết nối lại" });
    if (blocked) {
      expect(submit).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Đang tải hộp thư…");
    } else {
      await waitFor(() => expect(submit).not.toHaveAttribute("aria-disabled"));
      expect(screen.queryByRole("status")).toBeNull();
    }
  });

  it("reconnects the named mailbox with a new app password, without letting the address change", async () => {
    serve({ accounts: [accountJSON] });
    const onConnected = vi.fn();
    render(
      wrap(
        <ConnectAccountDialog
          wsId="ws1"
          open
          reconnectEmail="ha.do@unicomhub.com"
          onOpenChange={() => {}}
          onConnected={onConnected}
        />,
      ),
    );

    expect(screen.getByText("Kết nối lại ha.do@unicomhub.com")).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("ha.do@unicomhub.com");
    expect(email).toHaveAttribute("readonly");

    fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
    const submit = screen.getByRole("button", { name: "Kết nối lại" });
    await waitFor(() => expect(submit).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(submit);

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc1"));
    expect(toastSuccess).toHaveBeenCalledWith("Đã kết nối ha.do@unicomhub.com");
    expect(requestMock).toHaveBeenCalledWith(ACCOUNTS_PATH, {
      method: "POST",
      body: { email_address: "ha.do@unicomhub.com", app_password: "abcdefghijklmnop" },
    });
  });

  it("keeps the reconnect submit disabled when the account list fails to load", async () => {
    requestMock.mockImplementation((path: string) =>
      path === ACCOUNTS_PATH ? Promise.reject(new ApiError("boom", "internal", 500)) : Promise.resolve({}),
    );
    render(wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail="lan@unicomhub.vn" onOpenChange={() => {}} />));

    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === ACCOUNTS_PATH)).toBe(true));
    await act(async () => {}); // let the rejected list settle into the error state
    fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
    expect(screen.getByRole("button", { name: "Kết nối lại" })).toHaveAttribute("aria-disabled", "true");
    expect(requestMock).not.toHaveBeenCalledWith(ACCOUNTS_PATH, expect.objectContaining({ method: "POST" }));
    const loadFailed = screen.getByRole("alert");
    expect(loadFailed).toHaveTextContent("Không tải được thông tin hộp thư. Thử lại.");
    expect(loadFailed.querySelector("svg")).not.toBeNull();

    const reads = accountListReads();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(accountListReads()).toBeGreaterThan(reads));
  });

  it("keeps the reconnect title and fixed address while the dialog closes", () => {
    // jsdom has no animations; an exit animation that never ends keeps the popup on screen, as a browser does mid-fade.
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [{ finished: new Promise(() => {}) }],
    });
    try {
      const { rerender } = render(
        wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail="ha.do@unicomhub.com" onOpenChange={() => {}} />),
      );
      // The host clears the address together with open.
      rerender(wrap(<ConnectAccountDialog wsId="ws1" open={false} onOpenChange={() => {}} />));

      expect(screen.getByText("Kết nối lại ha.do@unicomhub.com")).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
      expect(screen.queryByRole("button", { name: /^Tên miền riêng/ })).not.toBeInTheDocument();
    } finally {
      // @ts-expect-error -- jsdom does not define it; drop the stub so other tests unmount at once.
      delete Element.prototype.getAnimations;
    }
  });

  it("puts an already-connected mailbox next to the email field", async () => {
    serve({ accounts: [] }, () => Promise.reject(new ApiError("already connected", "email_hub_already_connected", 409)));
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    fireEvent.click(appPasswordOption());

    fillAndSubmit("an@gmail.com", "Kết nối");

    const error = await screen.findByText("Hộp thư này đã được kết nối. Chọn hộp thư trong mục Tài khoản, hoặc nhập địa chỉ khác.");
    expect(error).toHaveAttribute("id", "email-hub-email-error");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["email_hub_smtp_disabled", 400, "Đăng nhập được nhưng máy chủ đã tắt gửi thư qua SMTP"],
    ["email_hub_tls_required", 400, "Máy chủ thư không hỗ trợ kết nối mã hóa"],
    ["email_hub_unreachable", 400, "Không kết nối được tới máy chủ thư."],
    ["email_hub_reauth_required", 409, "Hộp thư này cần kết nối lại."],
  ])("reads %s out as a sentence for the whole form", async (code, status, text) => {
    serve({ accounts: [] }, () => Promise.reject(new ApiError("refused", code, status)));
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    fireEvent.click(appPasswordOption());

    fillAndSubmit("an@gmail.com", "Kết nối");

    const description = await screen.findByText(
      (_, el) => el?.getAttribute("data-slot") === "alert-description" && el.textContent!.includes(text),
    );
    const alert = description.closest("[data-slot=alert]");
    // A long form may have scrolled it out of view: focus brings it back and reads it out, once (no live role too).
    await waitFor(() => expect(alert).toHaveFocus());
    expect(alert).not.toHaveAttribute("role");
  });

  it("keeps the submit enabled and asks for a missing address or app password next to its field", async () => {
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    fireEvent.click(appPasswordOption());
    const submit = screen.getByRole("button", { name: "Kết nối" });
    expect(submit).not.toHaveAttribute("aria-disabled");

    fireEvent.click(submit);
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAccessibleDescription("Nhập địa chỉ email, ví dụ ban@gmail.com.");
    expect(email).toHaveFocus();

    fireEvent.change(email, { target: { value: "an@gmail.com" } });
    fireEvent.click(submit);
    const password = screen.getByLabelText("App Password");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription("Nhập App Password của hộp thư.");
    expect(password).toHaveFocus();
    expect(requestMock).not.toHaveBeenCalledWith(ACCOUNTS_PATH, expect.objectContaining({ method: "POST" }));
  });

  it.each([
    ["an app-password mailbox", accountJSON, "App Password"],
    ["a custom-server mailbox", customJSON, "Mật khẩu"],
  ])("puts focus on the password, not the fixed address, when reconnecting %s", async (_, acc, label) => {
    serve({ accounts: [acc] });
    // Reconnect opens from a banner or the menu, with the list already loaded.
    const { rerender } = render(wrap(<ConnectAccountDialog wsId="ws1" open={false} onOpenChange={() => {}} />));
    await waitFor(() => expect(accountListReads()).toBeGreaterThan(0));
    await act(async () => {});

    rerender(wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail={acc.email_address} onOpenChange={() => {}} />));

    await waitFor(() => expect(screen.getByLabelText(label)).toHaveFocus());
  });

  it("opens the Gmail guide inside the dialog and comes back with the typed values", () => {
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    fireEvent.click(appPasswordOption());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "an@gmail.com" } });
    fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh" } });

    fireEvent.click(screen.getByRole("button", { name: "Hướng dẫn cho Gmail" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("Cách lấy App Password cho Gmail")).toBeInTheDocument();
    expect(screen.queryByLabelText("App Password")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));

    expect(screen.getByLabelText("Email")).toHaveValue("an@gmail.com");
    expect(screen.getByLabelText("App Password")).toHaveValue("abcd efgh");
  });

  it("gives an example app password and help for Outlook and Yahoo too", () => {
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    fireEvent.click(appPasswordOption());

    expect(screen.getByLabelText("App Password")).toHaveAttribute("placeholder", "abcd efgh ijkl mnop");
    for (const [name, href] of [
      ["Outlook", "https://support.microsoft.com/account-billing/how-to-get-and-use-app-passwords-5896ed9b-4263-e681-128a-a6f2979a7944"],
      ["Yahoo", "https://help.yahoo.com/kb/SLN15241.html"],
    ] as const) {
      const link = screen.getByRole("link", { name: new RegExp(`^${name}`) });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });
});

describe("ConnectAccountDialog sign-in with Google or Microsoft", () => {
  it.each([
    ["neither", NO_PROVIDERS, false, false],
    ["Google only", { google: true, microsoft: false }, true, false],
    ["both", BOTH, true, true],
  ])("offers %s on the method step, as the server enables them", async (_, providers, google, microsoft) => {
    serve({ accounts: [] }, undefined, { providers });
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === PROVIDERS_PATH)).toBe(true));
    await act(async () => {});
    await waitFor(() => {
      expect(googleOption() !== null).toBe(google);
      expect(microsoftOption() !== null).toBe(microsoft);
    });
    // The password ways stay either way: the own-domain card, and the app password demoted to a text link.
    expect(customOption()).toBeInTheDocument();
    expect(appPasswordOption()).toHaveClass("underline");
  });

  it("opens the popup on the click, before start answers, and sends no login_hint for a new mailbox", async () => {
    let answer: (value: unknown) => void = () => {};
    serve({ accounts: [] }, undefined, {
      providers: BOTH,
      start: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const { popup, open } = fakePopup();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    fireEvent.click(await screen.findByRole("button", { name: /^Đăng nhập bằng Google/ }));

    // In the click's own task, so the browser counts it as user-initiated and does not block it.
    expect(open.mock.calls[0]?.slice(0, 2)).toEqual(["about:blank", "uniwork-email-oauth"]);
    await waitFor(() => expect(startCall("google")).toBeDefined());
    expect(popup.location.href).toBe("");
    expect(startCall("google")?.[1]?.method).toBe("POST");
    expect(startCall("google")?.[1]?.body?.login_hint).toBeUndefined();

    await act(async () => answer({ authorization_url: AUTH_URL }));
    await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
  });

  it("closes the dialog and refetches the accounts when the popup reports connected", async () => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    await startGoogleSignIn(popup);
    const reads = accountListReads();

    postResult(popup, true, "connected");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(accountListReads()).toBeGreaterThan(reads));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refetches the accounts without an error when the popup closes with no message", async () => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    await startGoogleSignIn(popup);
    const reads = accountListReads();

    popup.closed = true;

    // The real 400ms poll: no fake timers needed.
    await waitFor(() => expect(accountListReads()).toBeGreaterThan(reads), { timeout: 2000 });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each([
    ["imap_not_enabled", "Đăng nhập được nhưng hộp thư này đang tắt IMAP"],
    ["denied", "quản trị viên của tổ chức cần duyệt UniWork"],
    ["a_code_from_a_newer_server", "Không hoàn tất được việc đăng nhập."],
  ])("reads the %s result out as a sentence and keeps the dialog open", async (code, text) => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    await startGoogleSignIn(popup);

    postResult(popup, false, code);

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("says the popup was blocked, without calling start or staying busy", async () => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    vi.spyOn(window, "open").mockReturnValue(null);
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    const google = await screen.findByRole("button", { name: /^Đăng nhập bằng Google/ });

    fireEvent.click(google);

    expect(await screen.findByRole("alert")).toHaveTextContent("Trình duyệt đã chặn cửa sổ đăng nhập");
    expect(startCall("google")).toBeUndefined();
    expect(google).toBeEnabled();
  });

  it("reconnects a Microsoft mailbox with one sign-in button that hints its address", async () => {
    serve({ accounts: [microsoftJSON] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    render(wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail="lan@contoso.vn" onOpenChange={() => {}} />));

    const microsoft = await screen.findByRole("button", { name: /^Đăng nhập bằng Microsoft/ });
    expect(screen.getByText("Kết nối lại lan@contoso.vn")).toBeInTheDocument();
    expect(screen.getByText(/^Đăng nhập lại bằng đúng tài khoản này/)).toBeInTheDocument();
    expect(googleOption()).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tên miền riêng/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Dùng App Password/ })).toBeNull();
    expect(screen.queryByLabelText("App Password")).toBeNull();

    fireEvent.click(microsoft);

    await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
    expect(startCall("microsoft")?.[1]).toEqual(
      expect.objectContaining({ method: "POST", body: expect.objectContaining({ login_hint: "lan@contoso.vn" }) }),
    );
  });

  it("holds two placeholder cards while the providers load, then none when neither is enabled", async () => {
    let answer: (value: unknown) => void = () => {};
    requestMock.mockImplementation((path: string) =>
      path === PROVIDERS_PATH
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve({ accounts: [] }),
    );
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    // Each placeholder draws the card it stands for: a mark and two lines of text.
    await waitFor(() => expect(document.querySelectorAll("[data-oauth-placeholder]")).toHaveLength(2));
    for (const card of document.querySelectorAll("[data-oauth-placeholder]")) {
      expect(card.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    }
    await act(async () => answer(NO_PROVIDERS));
    await waitFor(() => expect(document.querySelectorAll("[data-oauth-placeholder]")).toHaveLength(0));
    expect(googleOption()).toBeNull();
  });

  it("closes from a Cancel-only footer on the method step and on the OAuth reconnect", async () => {
    const onOpenChange = vi.fn();
    const { unmount } = render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("button", { name: "Kết nối" })).toBeNull();
    unmount();

    serve({ accounts: [microsoftJSON] }, undefined, { providers: BOTH });
    render(wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail="lan@contoso.vn" onOpenChange={onOpenChange} />));
    await screen.findByRole("button", { name: /^Đăng nhập bằng Microsoft/ });
    onOpenChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("holds every way in while the popup is open, keeps them in the tab order, and can bring the popup back", async () => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    const { popup, open } = fakePopup();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    await startGoogleSignIn(popup);

    // aria-disabled, not disabled: the clicked card keeps its place, so focus does not fall to the page.
    for (const option of [googleOption()!, microsoftOption()!, customOption(), appPasswordOption()]) {
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(option).not.toBeDisabled();
    }
    expect(screen.getByRole("status")).toHaveTextContent("Hoàn tất đăng nhập trong cửa sổ vừa mở.");
    const showWindow = screen.getByRole("button", { name: "Mở lại cửa sổ" });
    await waitFor(() => expect(showWindow).toHaveFocus());

    fireEvent.click(microsoftOption()!);
    fireEvent.click(customOption());
    fireEvent.click(appPasswordOption());
    expect(open).toHaveBeenCalledTimes(1);
    expect(document.getElementById("email-hub-custom-form")).toBeNull();
    expect(screen.queryByLabelText("App Password")).toBeNull();

    fireEvent.click(showWindow);
    expect(popup.focus).toHaveBeenCalled();
  });

  it("selects the new mailbox, says so and closes when the popup reports connected", async () => {
    const list = { accounts: [accountJSON] as unknown[] };
    serve(list, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    const onConnected = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} onConnected={onConnected} />));
    await screen.findByRole("button", { name: /^Đăng nhập bằng Google/ });
    await waitFor(() => expect(accountListReads()).toBeGreaterThan(0));
    await act(async () => {});
    await startGoogleSignIn(popup);
    list.accounts = [accountJSON, { ...accountJSON, id: "acc9", email_address: "moi@gmail.com", auth_kind: "oauth_google" }];

    postResult(popup, true, "connected");

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc9"));
    expect(toastSuccess).toHaveBeenCalledWith("Đã kết nối moi@gmail.com");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("selects the reconnected mailbox when its popup closes without a message but the list shows it fixed", async () => {
    const list = { accounts: [microsoftJSON] as unknown[] };
    serve(list, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    const onConnected = vi.fn();
    render(
      wrap(
        <ConnectAccountDialog wsId="ws1" open reconnectEmail="lan@contoso.vn" onOpenChange={onOpenChange} onConnected={onConnected} />,
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Đăng nhập bằng Microsoft/ }));
    await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
    list.accounts = [{ ...microsoftJSON, needs_reconnect: false, auth_failed_reason: "" }];

    popup.closed = true;

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc3"), { timeout: 2000 });
    expect(toastSuccess).toHaveBeenCalledWith("Đã kết nối lan@contoso.vn");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each([
    ["names neither mailbox it cannot identify", [] as unknown[], "Đã đăng nhập bằng một hộp thư khác. lan@contoso.vn vẫn cần kết nối lại.", null],
    [
      "names the mailbox it connected instead",
      [{ ...accountJSON, id: "acc9", email_address: "moi@outlook.com", auth_kind: "oauth_microsoft" }],
      "Đã đăng nhập bằng moi@outlook.com. lan@contoso.vn vẫn cần kết nối lại.",
      "acc9",
    ],
  ])("says a reconnect signed in as another mailbox and %s, without claiming the target", async (_, added, text, selected) => {
    const list = { accounts: [microsoftJSON] as unknown[] };
    serve(list, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    const onConnected = vi.fn();
    render(
      wrap(
        <ConnectAccountDialog wsId="ws1" open reconnectEmail="lan@contoso.vn" onOpenChange={onOpenChange} onConnected={onConnected} />,
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Đăng nhập bằng Microsoft/ }));
    await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
    // Signed in with another mailbox: the one to reconnect is still refused.
    list.accounts = [microsoftJSON, ...added];

    postResult(popup, true, "connected");

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith(text));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalledWith("acc3");
    if (selected) expect(onConnected).toHaveBeenCalledWith(selected);
    else expect(onConnected).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("finds the new mailbox when the list was still loading as the sign-in started", async () => {
    let firstList: (value: unknown) => void = () => {};
    const list = { accounts: [accountJSON] as unknown[] };
    let listReads = 0;
    requestMock.mockImplementation((path: string) => {
      if (path === PROVIDERS_PATH) return Promise.resolve(BOTH);
      if (path.endsWith("/start")) return Promise.resolve({ authorization_url: AUTH_URL });
      if (path !== ACCOUNTS_PATH) return Promise.resolve({});
      listReads += 1;
      return listReads === 1
        ? new Promise((resolve) => {
            firstList = resolve;
          })
        : Promise.resolve(list);
    });
    const { popup } = fakePopup();
    const onConnected = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} onConnected={onConnected} />));
    await startGoogleSignIn(popup);
    // The list lands while the popup is open; a short wait lets the parsed answer reach the screen.
    await act(async () => {
      firstList({ accounts: [accountJSON] });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    list.accounts = [accountJSON, { ...accountJSON, id: "acc9", email_address: "moi@gmail.com", auth_kind: "oauth_google" }];

    postResult(popup, true, "connected");

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc9"));
    expect(toastSuccess).toHaveBeenCalledWith("Đã kết nối moi@gmail.com");
  });

  it("notes, without an error, that the popup closed before connecting", async () => {
    serve({ accounts: [accountJSON] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onConnected = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} onConnected={onConnected} />));
    await startGoogleSignIn(popup);

    popup.closed = true;

    expect(
      await screen.findByText("Cửa sổ đăng nhập đã đóng trước khi kết nối xong. Thử lại.", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onConnected).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
