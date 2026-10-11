import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { EmailHubAccountMenu } from "./email-hub-account-menu";
import { EmailHubReconnectBanner } from "./email-hub-reconnect-banner";
import { emailHubThreadCapabilities } from "./email-hub-thread-toolbar";
import { EmailHubScheduledDetail } from "./email-hub-scheduled-detail";
import { EmailHubFolderSidebar } from "./email-hub-folder-sidebar";

initI18n();

const account = {
  id: "acc1",
  email_address: "ha.do@unicomhub.com",
  provider: "gmail",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: false,
  auth_failed_reason: "",
};

function thread(partial: Partial<EmailHubThread>): EmailHubThread {
  return {
    id: "t1",
    account_id: "acc1",
    folder: "INBOX",
    subject: "Báo giá",
    snippet: "",
    from_addr: "minh@example.com",
    to_addrs: [],
    sent_at: "2026-09-24T09:00:00Z",
    is_read: true,
    is_starred: false,
    has_attachments: false,
    body_cached: true,
    imap_labels: [],
    ...partial,
  };
}

describe("EmailHubAccountMenu", () => {
  it("asks before disconnecting a mailbox", async () => {
    const onDisconnect = vi.fn();
    render(
      <EmailHubAccountMenu
        accounts={[account]}
        activeAccountId="acc1"
        disconnectPending={false}
        onSelectAccount={() => {}}
        onDisconnect={onDisconnect}
        onAddAccount={() => {}}
        onReconnect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Hộp thư: ha.do@unicomhub.com/ }));
    const disconnectItem = await screen.findByRole("menuitem", { name: /Ngắt kết nối ha.do@unicomhub.com/ });
    expect(screen.queryByRole("menuitem", { name: /Kết nối lại/ })).not.toBeInTheDocument();
    fireEvent.click(disconnectItem);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ngắt kết nối ha.do@unicomhub.com?");
    expect(onDisconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ngắt kết nối" }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith("acc1", expect.any(Function)));
  });

  it("flags a mailbox that needs reconnecting and offers to reconnect it", async () => {
    const onReconnect = vi.fn();
    render(
      <EmailHubAccountMenu
        accounts={[{ ...account, needs_reconnect: true, auth_failed_reason: "imap_auth_failed" }]}
        activeAccountId="acc1"
        disconnectPending={false}
        onSelectAccount={() => {}}
        onDisconnect={() => {}}
        onAddAccount={() => {}}
        onReconnect={onReconnect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Hộp thư: ha.do@unicomhub.com/ }));
    expect(await screen.findByText("Cần kết nối lại")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Kết nối lại ha.do@unicomhub.com/ }));
    expect(onReconnect).toHaveBeenCalledWith("acc1");
  });
});

describe("EmailHubAccountMenu on mailboxes that need reconnecting", () => {
  const broken = { ...account, needs_reconnect: true, auth_failed_reason: "imap_auth_failed" };
  const accounts = [
    { ...account, id: "acc1", email_address: "an@gmail.com", auth_kind: "oauth_google" },
    { ...broken, id: "acc2", email_address: "binh@outlook.com", auth_kind: "oauth_microsoft" },
    { ...broken, id: "acc3", email_address: "chi@unicomhub.vn", provider: "custom" },
    { ...account, id: "acc4", email_address: "dung@yahoo.com", provider: "yahoo" },
  ];
  const renderMenu = (activeAccountId: string, onReconnect = vi.fn()) =>
    render(
      <EmailHubAccountMenu
        accounts={accounts}
        activeAccountId={activeAccountId}
        disconnectPending={false}
        onSelectAccount={() => {}}
        onDisconnect={() => {}}
        onAddAccount={() => {}}
        onReconnect={onReconnect}
      />,
    );

  it("marks the trigger when the mailbox in use needs reconnecting, in words too", () => {
    const { container } = renderMenu("acc2");
    expect(screen.getByRole("button", { name: "Hộp thư: binh@outlook.com — cần kết nối lại" })).toBeInTheDocument();
    expect(container.querySelector(".bg-warning-solid")).not.toBeNull();
  });

  it("keeps the trigger plain when the mailbox in use is fine", () => {
    const { container } = renderMenu("acc1");
    expect(screen.getByRole("button", { name: "Hộp thư: an@gmail.com" })).toBeInTheDocument();
    expect(container.querySelector(".bg-warning-solid")).toBeNull();
  });

  it("offers to reconnect every broken mailbox, not only the one in use", async () => {
    const onReconnect = vi.fn();
    renderMenu("acc1", onReconnect);
    fireEvent.click(screen.getByRole("button", { name: /Hộp thư: an@gmail.com/ }));
    expect(await screen.findByRole("menuitem", { name: "Kết nối lại binh@outlook.com" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Kết nối lại chi@unicomhub.vn" }));
    expect(onReconnect).toHaveBeenCalledWith("acc3");
    expect(screen.queryByRole("menuitem", { name: /Kết nối lại an@gmail.com/ })).toBeNull();
  });

  it("flags a broken row with an icon and its words, and marks each row by how it signs in", async () => {
    renderMenu("acc1");
    fireEvent.click(screen.getByRole("button", { name: /Hộp thư: an@gmail.com/ }));
    const row = await screen.findByRole("menuitemradio", { name: /binh@outlook.com/ });
    const flag = within(row).getByTitle("Cần kết nối lại");
    expect(flag).toHaveTextContent("Cần kết nối lại");
    expect(flag.querySelector("svg")).toHaveClass("text-warning");
    expect(row.querySelector("[data-slot=badge]")).toBeNull();

    const mark = (email: string) =>
      screen.getByRole("menuitemradio", { name: new RegExp(email) }).querySelector("[data-account-mark]")?.getAttribute("data-account-mark");
    expect(mark("an@gmail.com")).toBe("google");
    expect(mark("binh@outlook.com")).toBe("microsoft");
    expect(mark("chi@unicomhub.vn")).toBe("server");
    expect(mark("dung@yahoo.com")).toBe("mail");
  });
});

describe("EmailHubScheduledDetail", () => {
  it("names the status in words and confirms before cancelling", async () => {
    const onCancel = vi.fn();
    render(
      <EmailHubScheduledDetail
        item={{ id: "s1", send_at: "2026-09-25T02:00:00Z", subject: "Báo cáo tuần 39", to: ["bgd@example.com"], status: "pending" }}
        cancelPending={false}
        retryPending={false}
        onBack={() => {}}
        onCancel={onCancel}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("Đang chờ gửi")).toBeInTheDocument();
    expect(screen.queryByText("pending")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hủy lịch gửi" }));
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy lịch gửi" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("keeps an unknown status readable instead of dropping it", () => {
    render(
      <EmailHubScheduledDetail
        item={{ id: "s1", send_at: "2026-09-25T02:00:00Z", subject: "", to: [], status: "queued_retry" }}
        cancelPending={false}
        retryPending={false}
        onBack={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("queued_retry")).toBeInTheDocument();
  });

  it("says a failed send was not sent and offers to send it again or drop it", async () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    render(
      <EmailHubScheduledDetail
        item={{ id: "s1", send_at: "2026-09-25T02:00:00Z", subject: "Hợp đồng", to: ["a@example.com"], status: "failed" }}
        cancelPending={false}
        retryPending={false}
        onBack={() => {}}
        onCancel={onCancel}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Gửi không thành công")).toBeInTheDocument();
    expect(screen.getByText(/chưa được gửi/)).toBeInTheDocument();
    expect(screen.queryByText(/sẽ được gửi tự động/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy lịch gửi" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Gửi lại ngay" }));
    expect(onRetry).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Bỏ email này" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Bỏ email này" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });
});

describe("emailHubThreadCapabilities", () => {
  it("offers triage only in the inbox and restore only from trash or archive", () => {
    expect(emailHubThreadCapabilities(thread({ folder: "INBOX" }), "INBOX")).toMatchObject({
      canTriage: true,
      canTrash: true,
      canRestore: false,
      canMarkUnread: true,
    });
    expect(emailHubThreadCapabilities(thread({ folder: "TRASH" }), "TRASH")).toMatchObject({
      canTriage: false,
      canReply: false,
      canRestore: true,
    });
  });

  it("treats a thread opened from the spam folder as spam even before its cache catches up", () => {
    expect(emailHubThreadCapabilities(thread({ folder: "INBOX" }), "SPAM")).toMatchObject({ inSpam: true, canReply: false });
  });
});

describe("EmailHubFolderSidebar", () => {
  it("marks the current folder and locks the roadmap entry without making it clickable", () => {
    render(
      <EmailHubFolderSidebar
        folder="SENT"
        selectedLabel={null}
        imapLabels={[]}
        counts={{ inboxUnread: 3, scheduled: 0, snoozed: 0 }}
        onFolderChange={() => {}}
        onLabelChange={() => {}}
        composeDisabled={false}
        onCompose={() => {}}
        shortcutsOn
        onOpenShortcuts={() => {}}
        accountMenu={{
          accounts: [account],
          activeAccountId: "acc1",
          disconnectPending: false,
          onSelectAccount: () => {},
          onDisconnect: () => {},
          onAddAccount: () => {},
          onReconnect: () => {},
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /Đã gửi/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Hộp đến/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Sắp có")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nhãn và quy tắc tự động/ })).not.toBeInTheDocument();
  });
});

describe("EmailHubReconnectBanner", () => {
  it("says the mailbox needs reconnecting, that synced mail stays, and offers the way back", () => {
    const onReconnect = vi.fn();
    const { container } = render(<EmailHubReconnectBanner onReconnect={onReconnect} />);
    const banner = container.querySelector<HTMLElement>("[data-slot=alert]")!;
    expect(banner).toHaveTextContent("Hộp thư cần kết nối lại");
    expect(banner).toHaveTextContent("Thư đã đồng bộ vẫn đọc được.");
    // A standing state, not an event: a remount must not announce it again.
    expect(banner).not.toHaveAttribute("role");
    expect(banner.className).toContain("bg-warning-soft");
    fireEvent.click(within(banner).getByRole("button", { name: "Kết nối lại" }));
    expect(onReconnect).toHaveBeenCalled();
  });
});
