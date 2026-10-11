import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => requestMock.mockReset());

function fillAndSubmit(email: string | null, submitName: string) {
  if (email !== null) fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
  fireEvent.click(screen.getByRole("button", { name: submitName }));
}

describe("ConnectAccountDialog", () => {
  it("reconnects the named mailbox with a new app password, without letting the address change", async () => {
    requestMock.mockResolvedValue(accountJSON);
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

    fillAndSubmit(null, "Kết nối lại");

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc1"));
    expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/email-hub/accounts", {
      method: "POST",
      body: { email_address: "ha.do@unicomhub.com", app_password: "abcdefghijklmnop" },
    });
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
    } finally {
      // @ts-expect-error -- jsdom does not define it; drop the stub so other tests unmount at once.
      delete Element.prototype.getAnimations;
    }
  });

  it("puts an already-connected mailbox next to the email field", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("already connected", "email_hub_already_connected", 409));
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    fillAndSubmit("an@gmail.com", "Kết nối");

    const error = await screen.findByText("Hộp thư này đã được kết nối.");
    expect(error).toHaveAttribute("id", "email-hub-email-error");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["email_hub_smtp_disabled", 400, "Đăng nhập được nhưng máy chủ đã tắt gửi thư qua SMTP"],
    ["email_hub_tls_required", 400, "Máy chủ thư không hỗ trợ kết nối mã hóa"],
    ["email_hub_unreachable", 400, "Không kết nối được tới máy chủ thư."],
    ["email_hub_reauth_required", 409, "Hộp thư này cần kết nối lại."],
  ])("reads %s out as a sentence for the whole form", async (code, status, text) => {
    requestMock.mockRejectedValueOnce(new ApiError("refused", code, status));
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    fillAndSubmit("an@gmail.com", "Kết nối");

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });
});
