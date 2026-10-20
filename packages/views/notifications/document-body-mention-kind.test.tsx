import { cleanup, render, screen } from "@testing-library/react";
import { AtSign } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { NOTIFICATION_KINDS, type Notification, type Workspace } from "@uniwork/core/types";
import { moduleTone } from "../layout/module-tones";
import { NotificationsMatrix } from "../settings/components/notifications-matrix";
import { requestMock, wrap } from "../test/api-mock";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { inboxCategory } from "./notification-category";
import { NotificationTitle, notificationTitleKey } from "./notification-title";
import { resourceHref } from "./resource-href";

// UNI-1968 W3: the inbox renderer for a mention inside a UniNote page body
// (document.body_mentioned -> kind document_body_mentioned). The row looks and
// opens like a comment mention, except its deep link scrolls the page to the
// reader's own mention through ?mention=1.

const i18n = initI18n();
const { t } = i18n;

const workspace = { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" } as Workspace;
const sales = { id: "ws2", slug: "sales", name: "Sales", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" } as Workspace;

const notification = (params: Record<string, string> = {}, over: Partial<Notification> = {}): Notification => ({
  id: "n-body-1",
  kind: "document_body_mentioned",
  workspace_id: "ws1",
  organization_id: "o1",
  resource_type: "document",
  resource_id: "d1",
  resource_deleted: false,
  resource_access_lost: false,
  comment_deleted: false,
  actor_kind: "human",
  actor_id: "u2",
  title_key: "notifications.kind.document_body_mentioned",
  params,
  count: 1,
  created_at: "2026-10-19T10:00:00Z",
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

describe("UNI-1968 document_body_mentioned notification kind", () => {
  it("registers with the documents tone, the mention glyph and the mentions category", () => {
    expect(NOTIFICATION_KINDS).toContain("document_body_mentioned");
    expect(kindTone("document_body_mentioned")).toBe(moduleTone("documents"));
    expect(kindIcon("document_body_mentioned")).toBe(AtSign);
    expect(inboxCategory("document_body_mentioned")).toBe("mentions");
  });

  it("opens /{org}/{ws}/documents/{id}?mention=1 in the notification's workspace", () => {
    const n = notification({ actor: "An", document: "Kế hoạch" });
    expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/documents/d1?mention=1");
    expect(resourceHref({ ...n, workspace_id: "ws2" }, workspace, [workspace, sales])).toBe("/acme/sales/documents/d1?mention=1");
    // A share from a workspace the reader is not in falls back to the open one.
    expect(resourceHref({ ...n, workspace_id: "ws-other" }, workspace, [workspace, sales])).toBe("/acme/team/documents/d1?mention=1");
  });
  it("renders the vi and en sentences of contract S4", async () => {
    const n = notification({ actor: "An", document: "Kế hoạch" });
    await setLocale("vi");
    expect(sentence(n)).toBe("An đã nhắc đến bạn trong tài liệu “Kế hoạch”.");
    await setLocale("en");
    expect(sentence(n)).toBe("An mentioned you in “Kế hoạch”.");
  });

  it("uses the _untitled sentence when the document name is missing or blank in both locales", async () => {
    for (const params of [{ actor: "An" } as Record<string, string>, { actor: "An", document: "" }, { actor: "An", document: "   " }]) {
      const n = notification(params);
      expect(notificationTitleKey(n)).toBe("notifications.kind.document_body_mentioned_untitled");
      await setLocale("vi");
      const viText = sentence(n);
      expect(viText).toBe("An đã nhắc đến bạn trong một tài liệu.");
      expect(viText).not.toMatch(/notifications\.kind|\{\{|“\s*”/);
      await setLocale("en");
      const enText = sentence(n);
      expect(enText).toBe("An mentioned you in a document.");
      expect(enText).not.toMatch(/notifications\.kind|\{\{|“\s*”/);
    }
  });

  it("has the push title in vi and en (kindTitle)", async () => {
    await setLocale("vi");
    expect(t("notifications.kindTitle.document_body_mentioned")).toBe("Bạn được nhắc đến trong tài liệu");
    await setLocale("en");
    expect(t("notifications.kindTitle.document_body_mentioned")).toBe("You were mentioned in a document");
  });

  it("renders in notification settings with its vi and en labels", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/me/notification-preferences") return Promise.resolve({ preferences: [] });
      return Promise.resolve({ status: "ok" });
    });

    await setLocale("vi");
    const viLabel = t("settings.notifications.kinds.document_body_mentioned");
    expect(viLabel).not.toMatch(/settings\.notifications|document_body_mentioned/);
    const { unmount } = render(wrap(<NotificationsMatrix channels={["in_app", "push"]} />));
    expect(await screen.findByRole("rowheader", { name: viLabel })).toBeInTheDocument();
    unmount();

    await setLocale("en");
    const enLabel = t("settings.notifications.kinds.document_body_mentioned");
    expect(enLabel).not.toMatch(/settings\.notifications|document_body_mentioned/);
    render(
      wrap(
        <LocaleAdapterProvider adapter={{ getUserChoice: () => "en", getSystemPreferences: () => ["en"], persist: () => {} }}>
          <NotificationsMatrix channels={["in_app", "push"]} />
        </LocaleAdapterProvider>,
      ),
    );
    expect(await screen.findByRole("rowheader", { name: enLabel })).toBeInTheDocument();
  });
});
