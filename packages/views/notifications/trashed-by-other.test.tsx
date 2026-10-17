import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Notification, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { wrapWithNav } from "../test/api-mock";
import { NotificationRow } from "./notification-row";
import { NotificationTitle, notificationTitleKey } from "./notification-title";
import { resourceHref } from "./resource-href";

// TRASH-NOTIFY-01 (UNI-1844, addendum §4 N-1..N-4): "somebody else moved your
// document to the trash". The sentence says who and until when (the batch's
// purge date, in the reader's time zone); the line under it names the
// document and how many other items rode in the same batch; a click lands on
// the Thùng rác with that document focused.

const i18n = initI18n();
const t = i18n.t.bind(i18n);

const workspace = { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" } as Workspace;
const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const trashed = (params: Record<string, string> = {}): Notification => ({
  id: "n1", kind: "document_trashed_by_other", workspace_id: "ws1", organization_id: "o1", resource_type: "document",
  resource_id: "d1", resource_deleted: false, resource_access_lost: false, comment_deleted: false, actor_kind: "human",
  actor_id: "u2", title_key: "notifications.kind.document_trashed_by_other", count: 1, created_at: "2026-10-17T03:00:00Z",
  params: { actor: "Bình", document: "Kế hoạch Q4", date: "2026-11-16T17:30:00Z", count: "0", ...params },
});

const sentence = (n: Notification) => render(<NotificationTitle notification={n} unread={false} />).container.textContent ?? "";

function row(n: Notification) {
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ul><NotificationRow notification={n} href="/x" onOpen={() => undefined} /></ul>
      </WorkspaceProvider>,
    ),
  );
  return screen.getByRole("link");
}

const savedTZ = process.env.TZ;
beforeEach(() => {
  // 2026-11-16T17:30Z is already 17 Nov on this side of the date line.
  process.env.TZ = "Asia/Ho_Chi_Minh";
});
afterEach(() => {
  if (savedTZ === undefined) delete process.env.TZ;
  else process.env.TZ = savedTZ;
});

describe("document_trashed_by_other sentence", () => {
  it("names the actor and the purge date in the reader's time zone, as a date without a time", () => {
    const text = sentence(trashed());
    expect(text).toContain("Bình đã chuyển tài liệu của bạn vào thùng rác, khôi phục trước ");
    // 17:30Z is 00:30 on the 17th in Ho Chi Minh City.
    expect(text).toMatch(/17/);
    expect(text).not.toMatch(/16 /);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/2026-11|T17|Z$|\{\{/);
  });

  it("leaves the year off a date in the viewer's current year and keeps it for another year", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-17T03:00:00Z"));
      expect(sentence(trashed())).not.toMatch(/2026/);
      expect(sentence(trashed({ date: "2027-01-05T10:00:00Z" }))).toMatch(/2027/);
      await i18n.changeLanguage("en");
      expect(sentence(trashed())).toMatch(/Nov 17$/);
      expect(sentence(trashed({ date: "2027-01-05T10:00:00Z" }))).toMatch(/Jan 5, 2027$/);
    } finally {
      vi.useRealTimers();
      await i18n.changeLanguage("vi");
    }
  });

  it("moves the date to the previous day for a viewer west of UTC", () => {
    process.env.TZ = "America/Los_Angeles";
    const text = sentence(trashed());
    expect(text).toMatch(/16/);
    expect(text).not.toMatch(/17/);
  });

  it("reads in English for an English viewer", async () => {
    await i18n.changeLanguage("en");
    const text = sentence(trashed());
    expect(text).toMatch(/^Bình moved your document to trash\. Restore it before /);
    expect(text).toMatch(/Nov/);
    expect(text).toMatch(/17/);
  });

  it("uses the title-less sentence once the document name is gone, and it resolves", () => {
    const n = trashed({ document: "" });
    expect(notificationTitleKey(n)).toBe("notifications.kind.document_trashed_by_other_untitled");
    const text = sentence(n);
    expect(text).toContain("một tài liệu của bạn");
    expect(text).not.toMatch(/notifications\.kind|\{\{/);
  });

  it("drops the date part for an empty or invalid date, with no dangling 'trước '", async () => {
    for (const date of ["", "soon"]) {
      expect(sentence(trashed({ date }))).toBe("Bình đã chuyển tài liệu của bạn vào thùng rác");
      expect(sentence(trashed({ date, document: "" }))).toBe("Bình đã chuyển một tài liệu của bạn vào thùng rác");
    }
    await i18n.changeLanguage("en");
    expect(sentence(trashed({ date: "" }))).toBe("Bình moved your document to trash");
    expect(sentence(trashed({ date: "", document: "" }))).toBe("Bình moved one of your documents to trash");
  });
});

describe("document_trashed_by_other row", () => {
  it("names the document alone when nothing else rode in the batch", () => {
    const link = row(trashed({ count: "0" }));
    expect(link).toHaveTextContent("“Kế hoạch Q4”");
    expect(link).not.toHaveTextContent(/mục khác/);
  });

  it("adds one more item to the line", () => {
    expect(row(trashed({ count: "1" }))).toHaveTextContent("“Kế hoạch Q4” và 1 mục khác");
  });

  it("adds the English suffix with its plural forms", async () => {
    await i18n.changeLanguage("en");
    expect(t("notifications.trashed_more", { count: 1 })).toBe("and 1 more");
    expect(t("notifications.trashed_more", { count: 3 })).toBe("and 3 more");
    expect(row(trashed({ count: "3" }))).toHaveTextContent("“Kế hoạch Q4” and 3 more");
  });

  it("adds three more items to the line", () => {
    expect(row(trashed({ count: "3" }))).toHaveTextContent("“Kế hoạch Q4” và 3 mục khác");
  });

  it("says only how many more when the top item has no name", () => {
    const link = row(trashed({ document: "", count: "3" }));
    expect(link).toHaveTextContent("và 3 mục khác");
    expect(link).not.toHaveTextContent("“");
  });

  it("shows no document line for an untitled single item, and a bad count counts as none", () => {
    const link = row(trashed({ document: "", count: "many" }));
    expect(link.querySelector("[data-notification-snippet]")).toBeNull();
  });

  it("shows no document line once the reader lost the document", () => {
    const link = row({ ...trashed({ count: "3" }), resource_access_lost: true });
    expect(link.querySelector("[data-notification-snippet]")).toBeNull();
  });
});

describe("document_trashed_by_other click target (N-4)", () => {
  it("opens the Thùng rác with the document focused", () => {
    expect(resourceHref(trashed(), workspace, [workspace])).toBe("/acme/team/documents?view=archived&focus=d1");
  });

  it("opens in the notification's own workspace when the reader belongs to it", () => {
    const sales = { id: "ws2", slug: "sales", organization_id: "o1", organization_slug: "acme" } as Workspace;
    const n = { ...trashed(), workspace_id: "ws2" };
    expect(resourceHref(n, workspace, [workspace, sales])).toBe("/acme/sales/documents?view=archived&focus=d1");
  });

  it("leaves the other document kinds opening the document", () => {
    const n = { ...trashed(), kind: "document_access_approved" };
    expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/documents/d1");
  });
});

describe("document_trashed_by_other row at phone width (visual F1)", () => {
  it("lets the sentence run to three lines so the purge date is not clamped; other kinds stay at two", () => {
    const sentenceLine = (n: Notification) => row(n).querySelector(".text-body.text-pretty");
    expect(sentenceLine(trashed())?.className).toContain("line-clamp-3");
    cleanup();
    expect(sentenceLine({ ...trashed(), kind: "document_access_approved", title_key: "notifications.kind.document_access_approved" })?.className).toContain(
      "line-clamp-2",
    );
  });

  it("keeps the 'and N more' suffix out of the ellipsis: the name truncates, the suffix does not shrink", () => {
    const snippet = row(trashed({ count: "5" })).querySelector("[data-notification-snippet]");
    expect(snippet?.className).not.toContain("line-clamp-1");
    const [name, more] = Array.from(snippet?.children ?? []);
    expect(name?.className).toContain("truncate");
    expect(name).toHaveTextContent("“Kế hoạch Q4”");
    expect(more?.className).toContain("shrink-0");
    expect(more).toHaveTextContent("và 5 mục khác");
  });
});
