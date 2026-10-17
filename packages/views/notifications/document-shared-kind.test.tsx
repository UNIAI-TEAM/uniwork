import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { NOTIFICATION_KINDS, type Notification, type Workspace } from "@uniwork/core/types";
import { moduleTone } from "../layout/module-tones";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NotificationsMatrix } from "../settings/components/notifications-matrix";
import { requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { groupInbox } from "./inbox-groups";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { inboxCategory } from "./notification-category";
import { NotificationRow } from "./notification-row";
import { NotificationTitle, notificationTitleKey } from "./notification-title";
import { resourceHref } from "./resource-href";

// SH-W3 (UNI-1786; addendum §8 FR-13): Inbox renderer for document_shared.

const i18n = initI18n();
const { t } = i18n;
const LEVELS = ["view", "comment", "edit", "manage"] as const;

const workspace = { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" } as Workspace;
const sales = { id: "ws2", slug: "sales", name: "Sales", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" } as Workspace;

const notification = (params: Record<string, string> = {}, over: Partial<Notification> = {}): Notification => ({
  id: "n-shared-1",
  kind: "document_shared",
  workspace_id: "ws1",
  organization_id: "o1",
  resource_type: "document",
  resource_id: "d1",
  resource_deleted: false,
  resource_access_lost: false,
  comment_deleted: false,
  actor_kind: "human",
  actor_id: "u2",
  title_key: "notifications.kind.document_shared",
  params,
  count: 1,
  created_at: "2026-10-17T10:00:00Z",
  ...over,
});

const sentence = (n: Notification) => {
  const { container, unmount } = render(<NotificationTitle notification={n} unread={false} />);
  const text = container.textContent ?? "";
  unmount();
  return text;
};

beforeEach(async () => {
  requestMock.mockReset();
  await setLocale("vi");
});

afterEach(async () => {
  cleanup();
  await setLocale("vi");
});

describe("SH-W3 document_shared notification kind", () => {
  it("registers document_shared with the documents tone, CircleCheck glyph and updates category", () => {
    expect(NOTIFICATION_KINDS).toContain("document_shared");
    expect(kindTone("document_shared")).toBe(moduleTone("documents"));
    expect(kindIcon("document_shared")).toBe(kindIcon("document_access_approved"));
    expect(kindIcon("document_shared")).not.toBe(kindIcon("kind_from_a_newer_server"));
    expect(inboxCategory("document_shared")).toBe("updates");
  });

  it("opens /{org}/{ws}/documents/{id} through resourceHref, respecting documentWorkspace fallback", () => {
    const n = notification({ actor: "An", document: "Kế hoạch", document_id: "d1", level: "edit" });
    expect(resourceHref(n, workspace, [workspace, sales])).toBe("/acme/team/documents/d1");
    expect(resourceHref({ ...n, workspace_id: "ws2" }, workspace, [workspace, sales])).toBe("/acme/sales/documents/d1");
    expect(resourceHref({ ...n, workspace_id: "ws-other" }, workspace, [workspace, sales])).toBe("/acme/team/documents/d1");
  });

  it.each(LEVELS)("renders the vi and en sentences for level %s using documents.share.level_*", async (level) => {
    const n = notification({ actor: "An", document: "Hợp đồng", document_id: "d1", level });

    await setLocale("vi");
    const viLevel = t(`documents.share.level_${level}`);
    expect(sentence(n)).toBe(`An đã chia sẻ tài liệu “Hợp đồng” với bạn. Quyền: ${viLevel}.`);

    await setLocale("en");
    const enLevel = t(`documents.share.level_${level}`);
    expect(sentence(n)).toBe(`An shared “Hợp đồng” with you (${enLevel}).`);
  });

  it("falls back gracefully on an unknown or missing level without throwing or leaking a raw key", async () => {
    const unknown = notification({ actor: "An", document: "Hợp đồng", document_id: "d1", level: "super_edit" });
    await setLocale("vi");
    expect(sentence(unknown)).toBe("An đã chia sẻ tài liệu “Hợp đồng” với bạn. Quyền: super_edit.");
    expect(sentence(unknown)).not.toMatch(/documents\.share\.level_|notifications\.kind|\{\{/);

    await setLocale("en");
    expect(sentence(unknown)).toBe("An shared “Hợp đồng” with you (super_edit).");
    expect(sentence(unknown)).not.toMatch(/documents\.share\.level_|notifications\.kind|\{\{/);

    const missingLevel = notification({ actor: "An", document: "Hợp đồng", document_id: "d1" });
    expect(() => sentence(missingLevel)).not.toThrow();
    expect(sentence(missingLevel)).not.toMatch(/documents\.share\.level_|notifications\.kind|\{\{/);
  });

  it("uses the _untitled sentence when the document name is missing or blank in both locales", async () => {
    const cases: Record<string, string>[] = [
      { actor: "An", level: "view" },
      { actor: "An", document: "", level: "view" },
      { actor: "An", document: "   ", level: "view" },
    ];
    for (const params of cases) {
      const n = notification(params);
      expect(notificationTitleKey(n)).toBe("notifications.kind.document_shared_untitled");

      await setLocale("vi");
      const viText = sentence(n);
      expect(viText).toBe(`An đã chia sẻ một tài liệu với bạn. Quyền: ${t("documents.share.level_view")}.`);
      expect(viText).not.toMatch(/notifications\.kind|\{\{|“\s*”/);

      await setLocale("en");
      const enText = sentence(n);
      expect(enText).toBe(`An shared a document with you (${t("documents.share.level_view")}).`);
      expect(enText).not.toMatch(/notifications\.kind|\{\{|“\s*”/);
    }
  });

  it("renders a grouped document_shared row with its document link and merged count", () => {
    const n = notification({ actor: "An", document: "Kế hoạch", document_id: "d1", level: "edit" }, { count: 3 });
    const href = resourceHref(n, workspace, [workspace]);
    render(
      wrapWithNav(
        <WorkspaceProvider
          workspace={workspace}
          user={{
            id: "u1",
            email: "a@b.c",
            display_name: "Người nhận",
            onboarded_at: "2026-08-25T00:00:00Z",
            email_verified_at: "2026-08-25T00:00:00Z",
            onboarding_questionnaire: {},
            locale: "vi",
          }}
        >
          <ul>
            <NotificationRow notification={n} href={href} onOpen={() => {}} />
          </ul>
        </WorkspaceProvider>,
      ),
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/acme/team/documents/d1");
    expect(screen.getByText(t("notifications.merged_other", { count: 2 }))).toBeInTheDocument();

    const groups = groupInbox([n], new Date("2026-10-17T12:00:00Z"));
    expect(groups).toEqual([{ key: "unread", rows: [n] }]);
  });

  it("renders document_shared in notification settings with its vi and en labels", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/me/notification-preferences") {
        return Promise.resolve({ preferences: [] });
      }
      return Promise.resolve({ status: "ok" });
    });

    await setLocale("vi");
    expect(t("notifications.kindTitle.document_shared")).toBe("Tài liệu được chia sẻ");
    expect(t("settings.notifications.kinds.document_shared")).toBe("Tài liệu được chia sẻ với bạn");

    const { unmount } = render(wrap(<NotificationsMatrix channels={["in_app", "email"]} />));
    expect(await screen.findByRole("rowheader", { name: "Tài liệu được chia sẻ với bạn" })).toBeInTheDocument();
    unmount();

    await setLocale("en");
    expect(t("notifications.kindTitle.document_shared")).toBe("Document shared");
    expect(t("settings.notifications.kinds.document_shared")).toBe("Documents shared with you");

    render(
      wrap(
        <LocaleAdapterProvider
          adapter={{ getUserChoice: () => "en", getSystemPreferences: () => ["en"], persist: () => {} }}
        >
          <NotificationsMatrix channels={["in_app", "email"]} />
        </LocaleAdapterProvider>,
      ),
    );
    expect(await screen.findByRole("rowheader", { name: "Documents shared with you" })).toBeInTheDocument();
  });
});
