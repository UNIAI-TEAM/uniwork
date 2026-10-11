import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrap } from "../test/api-mock";
import { ConnectAccountDialog } from "./connect-account-dialog";

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

const ACCOUNTS_PATH = "/api/v1/workspaces/ws1/email-hub/accounts";

/** The dialog reads the account list (GET) and connects with a POST to the same path. */
function serve(list: unknown, connect: () => Promise<unknown> = () => Promise.resolve(accountJSON)) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path !== ACCOUNTS_PATH) return Promise.resolve({});
    return opts?.method === "POST" ? connect() : Promise.resolve(list);
  });
}

beforeEach(() => {
  requestMock.mockReset();
  serve({ accounts: [] });
});

const customOption = () => screen.getByRole("button", { name: /^Tên miền riêng \(IMAP\/SMTP\)/ });
const appPasswordOption = () => screen.getByRole("button", { name: /^Dùng mật khẩu ứng dụng/ });

function fillAndSubmit(email: string | null, submitName: string) {
  if (email !== null) fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
  fireEvent.click(screen.getByRole("button", { name: submitName }));
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
    expect(screen.getByRole("button", { name: "Xem hướng dẫn từng bước kèm minh họa" })).toBeInTheDocument();
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
    if (blocked) expect(submit).toBeDisabled();
    else await waitFor(() => expect(submit).toBeEnabled());
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
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc1"));
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
    expect(screen.getByRole("button", { name: "Kết nối lại" })).toBeDisabled();
    expect(requestMock).not.toHaveBeenCalledWith(ACCOUNTS_PATH, expect.objectContaining({ method: "POST" }));
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

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });
});
