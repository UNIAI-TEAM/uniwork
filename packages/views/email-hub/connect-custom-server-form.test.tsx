import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import { wrap } from "../test/api-mock";
import { ConnectCustomServerForm } from "./connect-custom-server-form";

function renderForm({
  error = null,
  initial,
  pending = false,
}: { error?: unknown; initial?: EmailHubAccount; pending?: boolean } = {}) {
  const onSubmit = vi.fn();
  render(
    wrap(
      <ConnectCustomServerForm
        formId="custom-form"
        pending={pending}
        error={error}
        initial={initial}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    ),
  );
  return onSubmit;
}

const imap = () => within(screen.getByRole("group", { name: "Thư đến (IMAP)" }));
const smtp = () => within(screen.getByRole("group", { name: "Thư đi (SMTP)" }));
// Radios render in the order SSL/TLS, then STARTTLS.
const TLS = 0;
const STARTTLS = 1;
const radio = (side: typeof imap, index: number) => side().getAllByRole("radio")[index]!;
const usernameToggle = () => screen.getByRole("button", { name: "Tên đăng nhập khác email?" });

function fillRequired() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  ha.do@congty.vn " } });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "pass word 1" } });
  fireEvent.change(imap().getByLabelText("Máy chủ"), { target: { value: " mail.congty.vn " } });
  fireEvent.change(smtp().getByLabelText("Máy chủ"), { target: { value: "smtp.congty.vn" } });
}

const customAccount: EmailHubAccount = {
  id: "acc1",
  email_address: "ha.do@congty.vn",
  provider: "custom",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: true,
  auth_failed_reason: "imap_auth_failed",
  imap_host: "mail.congty.vn",
  imap_port: 143,
  imap_security: "starttls",
  smtp_host: "smtp.congty.vn",
  smtp_port: 465,
  smtp_security: "tls",
  username: "hado",
};

describe("ConnectCustomServerForm", () => {
  it("starts on SSL/TLS 993 for IMAP and STARTTLS 587 for SMTP", () => {
    renderForm();

    expect(imap().getByLabelText("Cổng")).toHaveValue("993");
    expect(radio(imap, TLS)).toHaveAttribute("aria-checked", "true");
    expect(smtp().getByLabelText("Cổng")).toHaveValue("587");
    expect(radio(smtp, STARTTLS)).toHaveAttribute("aria-checked", "true");
  });

  it("moves the port with the security mode until the port is typed by hand", () => {
    renderForm();

    fireEvent.click(radio(imap, STARTTLS));
    expect(imap().getByLabelText("Cổng")).toHaveValue("143");
    fireEvent.click(radio(smtp, TLS));
    expect(smtp().getByLabelText("Cổng")).toHaveValue("465");

    fireEvent.change(imap().getByLabelText("Cổng"), { target: { value: "10993" } });
    fireEvent.click(radio(imap, TLS));
    expect(radio(imap, TLS)).toHaveAttribute("aria-checked", "true");
    expect(imap().getByLabelText("Cổng")).toHaveValue("10993");
  });

  it("sends numbers for the ports, the password as typed, and a username only when one is given", () => {
    const onSubmit = renderForm();
    fillRequired();
    fireEvent.click(usernameToggle());
    expect(screen.getByLabelText("Tên đăng nhập")).toHaveAttribute("placeholder", "ha.do@congty.vn");

    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: "ha.do@congty.vn",
      appPassword: "pass word 1",
      server: {
        imap_host: "mail.congty.vn",
        imap_port: 993,
        imap_security: "tls",
        smtp_host: "smtp.congty.vn",
        smtp_port: 587,
        smtp_security: "starttls",
      },
    });

    fireEvent.change(screen.getByLabelText("Tên đăng nhập"), { target: { value: " hado " } });
    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ server: expect.objectContaining({ username: "hado" }) }),
    );
  });

  it("marks a bad email, an empty server and a non-numeric port without submitting", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ha.do" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "secret" } });
    fireEvent.change(smtp().getByLabelText("Máy chủ"), { target: { value: "smtp.congty.vn" } });
    fireEvent.change(smtp().getByLabelText("Cổng"), { target: { value: "99a" } });

    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));

    expect(onSubmit).not.toHaveBeenCalled();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Email chưa đúng định dạng, ví dụ ban@gmail.com.");
    expect(email).toHaveFocus();
    expect(imap().getByLabelText("Máy chủ")).toHaveAccessibleDescription("Nhập tên máy chủ, ví dụ mail.congty.vn.");
    expect(smtp().getByLabelText("Cổng")).toHaveAccessibleDescription("Nhập số cổng, ví dụ 993.");
    expect(imap().getByLabelText("Cổng")).not.toHaveAttribute("aria-invalid");
  });

  it("puts a server-refused SMTP port next to that input", () => {
    renderForm({ error: new ApiError("invalid", "email_hub_invalid_server", 400, undefined, { field: "smtp_port" }) });

    const port = smtp().getByLabelText("Cổng");
    expect(port).toHaveAttribute("aria-invalid", "true");
    expect(port).toHaveAttribute("aria-describedby", "email-hub-custom-smtp_port-error");
    expect(port).toHaveAccessibleDescription("Thông tin máy chủ thư này chưa đúng. Kiểm tra lại rồi thử lại.");
    expect(imap().getByLabelText("Cổng")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("puts a refused private address next to the IMAP server", () => {
    renderForm({ error: new ApiError("not allowed", "email_hub_host_not_allowed", 400, undefined, { field: "imap_host" }) });

    const host = imap().getByLabelText("Máy chủ");
    expect(host).toHaveAttribute("aria-invalid", "true");
    expect(host).toHaveAccessibleDescription(
      "UniWork không kết nối tới địa chỉ mạng nội bộ hoặc dải địa chỉ dành riêng. Nhập tên công khai của máy chủ thư.",
    );
  });

  it("puts a refused sign-in next to the password", () => {
    renderForm({ error: new ApiError("bad login", "email_hub_connect_failed", 400) });

    const password = screen.getByLabelText("Mật khẩu");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-describedby", "email-hub-custom-password-error");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [new ApiError("tls", "email_hub_tls_required", 400), "Máy chủ thư không hỗ trợ kết nối mã hóa"],
    [new ApiError("down", "email_hub_unreachable", 400), "máy chủ thư"],
    [new ApiError("slow down", "rate_limited", 429), "Chờ vài phút rồi thử lại."],
    // A field name the form does not show must not match a prototype key; it reads out for the whole form.
    [new ApiError("invalid", "email_hub_invalid_server", 400, undefined, { field: "constructor" }), "Thông tin máy chủ thư này chưa đúng."],
  ])("reads %s out for the whole form, and moves focus there", (error, text) => {
    renderForm({ error });

    const alert = screen.getByText((_, el) => el?.getAttribute("data-slot") === "alert-description" && el.textContent!.includes(text))
      .parentElement!;
    expect(alert).toHaveFocus();
    // Focus reads it out; a live role on top would announce it a second time.
    expect(alert).not.toHaveAttribute("role");
  });

  it("keeps the login name behind a disclosure until asked for", () => {
    renderForm();
    expect(screen.queryByLabelText("Tên đăng nhập")).toBeNull();
    expect(usernameToggle()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(usernameToggle());

    expect(usernameToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Tên đăng nhập")).toBeInTheDocument();
  });

  it.each([
    ["a saved login name", { initial: customAccount }],
    ["a refused login name", { error: new ApiError("invalid", "email_hub_invalid_server", 400, undefined, { field: "username" }) }],
  ])("opens the login name for %s", (_, props) => {
    renderForm(props);

    expect(usernameToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Tên đăng nhập")).toBeInTheDocument();
  });

  it("explains once which port goes with which security mode, for both choices", () => {
    renderForm();
    const hint = "Cổng mặc định: SSL/TLS 993 (IMAP), 465 (SMTP); STARTTLS 143, 587. Cổng tự đổi nếu bạn chưa sửa tay.";

    expect(screen.getAllByText(hint)).toHaveLength(1);
    expect(imap().getByRole("radiogroup")).toHaveAccessibleDescription(hint);
    expect(smtp().getByRole("radiogroup")).toHaveAccessibleDescription(hint);
  });

  it("lets a refused login name be hidden again once it is open", () => {
    renderForm({ error: new ApiError("invalid", "email_hub_invalid_server", 400, undefined, { field: "username" }) });
    expect(usernameToggle()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(usernameToggle());

    expect(usernameToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Tên đăng nhập")).toBeNull();
  });

  it("keeps the submit enabled and asks for a missing password next to it", () => {
    const onSubmit = renderForm();
    fillRequired();
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "" } });
    const submit = screen.getByRole("button", { name: "Kết nối" });
    expect(submit).not.toHaveAttribute("aria-disabled");

    fireEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    const password = screen.getByLabelText("Mật khẩu");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription("Nhập mật khẩu của hộp thư.");
    expect(password).toHaveFocus();

    fireEvent.change(password, { target: { value: "x" } });
    expect(password).not.toHaveAttribute("aria-invalid");
  });

  it("says a slow server check is expected while connecting", () => {
    renderForm({ pending: true });

    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra máy chủ thư. Có thể mất tới 30 giây.");
  });

  it("shows and hides the password on request", () => {
    renderForm();
    const password = screen.getByLabelText("Mật khẩu");
    expect(password).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Hiện mật khẩu" }));

    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ẩn mật khẩu" })).toHaveAttribute("aria-pressed", "true");
  });

  it("fills a custom mailbox's servers for reconnecting, but never its password", () => {
    renderForm({ initial: customAccount });

    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("ha.do@congty.vn");
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Tên đăng nhập")).toHaveValue("hado");
    expect(screen.getByLabelText("Mật khẩu")).toHaveValue("");
    expect(imap().getByLabelText("Máy chủ")).toHaveValue("mail.congty.vn");
    expect(imap().getByLabelText("Cổng")).toHaveValue("143");
    expect(radio(imap, STARTTLS)).toHaveAttribute("aria-checked", "true");
    expect(smtp().getByLabelText("Máy chủ")).toHaveValue("smtp.congty.vn");
    expect(smtp().getByLabelText("Cổng")).toHaveValue("465");
    expect(radio(smtp, TLS)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Kết nối lại" })).not.toHaveAttribute("aria-disabled");
  });
});
