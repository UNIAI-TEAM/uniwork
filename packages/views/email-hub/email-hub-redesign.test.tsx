import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { EmailHubAccountMenu } from "./email-hub-account-menu";
import { emailHubThreadCapabilities } from "./email-hub-thread-toolbar";
import { EmailHubScheduledDetail } from "./email-hub-scheduled-detail";
import { EmailHubFolderSidebar } from "./email-hub-folder-sidebar";

initI18n();

const account = {
  id: "acc1",
  email_address: "ha.do@unicomhub.com",
  provider: "gmail",
  connected_at: "2026-09-01T00:00:00Z",
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
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Hộp thư: ha.do@unicomhub.com/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Ngắt kết nối ha.do@unicomhub.com/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ngắt kết nối ha.do@unicomhub.com?");
    expect(onDisconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ngắt kết nối" }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith("acc1", expect.any(Function)));
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
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /Đã gửi/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Hộp đến/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Sắp có")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nhãn và quy tắc tự động/ })).not.toBeInTheDocument();
  });
});
