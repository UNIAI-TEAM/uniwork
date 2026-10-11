import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { wrap } from "../test/api-mock";
import { EmailHubThreadDetail } from "./email-hub-thread-detail";
import type { EmailHubThreadActions } from "./email-hub-thread-toolbar";

initI18n();

function thread(id: string): EmailHubThread {
  return {
    id,
    account_id: "acc1",
    folder: "INBOX",
    subject: `Bản tin ${id}`,
    snippet: "",
    from_addr: "news@example.com",
    to_addrs: [],
    sent_at: "2026-09-24T09:00:00Z",
    is_read: true,
    is_starred: false,
    has_attachments: false,
    body_cached: true,
    imap_labels: [],
    body_html: `<p>Hi</p><img src="https://track.example.com/${id}.gif">`,
  };
}

const actions = new Proxy({}, { get: () => vi.fn() }) as EmailHubThreadActions;
const pending = { star: false, move: false, markRead: false, snooze: false, download: false };

function detail(active: EmailHubThread) {
  return wrap(
    <EmailHubThreadDetail
      wsId="ws1"
      accountId="acc1"
      activeThread={active}
      browserFolder="INBOX"
      detailData={active}
      readableBody
      bodyLoading={false}
      bodyLoadFailed={false}
      onBodyRefetch={() => {}}
      actions={actions}
      pending={pending}
      aiOpen={false}
    />,
  );
}

const frameDoc = () => screen.getByTitle(/^Bản tin/).getAttribute("srcdoc") ?? "";

describe("EmailHubThreadDetail remote images", () => {
  it("shows images only for the email the reader allowed, never the next one", () => {
    const { rerender } = render(detail(thread("a")));
    expect(frameDoc()).toContain("img-src data: cid:");

    fireEvent.click(screen.getByRole("button", { name: "Hiện ảnh" }));
    expect(screen.queryByRole("button", { name: "Hiện ảnh" })).not.toBeInTheDocument();
    expect(frameDoc()).not.toContain("img-src data: cid:");

    rerender(detail(thread("b")));
    expect(screen.getByRole("button", { name: "Hiện ảnh" })).toBeInTheDocument();
    expect(frameDoc()).toContain("img-src data: cid:");

    // A fresh mount (another session, a reload) starts blocked too.
    rerender(<></>);
    render(detail(thread("c")));
    expect(screen.getByRole("button", { name: "Hiện ảnh" })).toBeInTheDocument();
  });
});
