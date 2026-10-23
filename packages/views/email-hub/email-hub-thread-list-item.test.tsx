import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import * as formatters from "./email-hub-format";
import { EmailHubThreadListItem } from "./email-hub-thread-list-item";

vi.mock("./email-hub-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email-hub-format")>()),
  formatEmailFullDate: vi.fn(() => "full date"),
  formatEmailListDate: vi.fn(() => "list date"),
}));

const row: EmailHubThread = {
  id: "thread-1",
  account_id: "account-1",
  folder: "INBOX",
  subject: "Báo cáo tuần",
  snippet: "Tóm tắt báo cáo",
  from_addr: "lam@example.com",
  from_name: "Lâm",
  to_addrs: ["team@example.com"],
  sent_at: "2026-09-24T09:00:00Z",
  is_read: false,
  is_starred: false,
  has_attachments: false,
  body_cached: true,
  imap_labels: [],
};

beforeEach(() => vi.clearAllMocks());

describe("EmailHubThreadListItem date formatting", () => {
  it("formats and reuses the sent date once per render", () => {
    render(
      <ul>
        <EmailHubThreadListItem
          row={row}
          checked={false}
          selectionMode={false}
          onCheckedChange={() => {}}
          onSelect={() => {}}
          onPrefetch={() => {}}
          onToggleStar={() => {}}
        />
      </ul>,
    );

    expect(formatters.formatEmailFullDate).toHaveBeenCalledTimes(1);
    expect(formatters.formatEmailFullDate).toHaveBeenCalledWith(row.sent_at, "vi-VN");
    expect(formatters.formatEmailListDate).toHaveBeenCalledTimes(1);
    expect(formatters.formatEmailListDate).toHaveBeenCalledWith(row.sent_at, "vi-VN");
  });
});
