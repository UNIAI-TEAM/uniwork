import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { NOTIFICATION_KINDS, type Notification, type Workspace } from "@uniwork/core/types";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { moduleTone } from "../layout/module-tones";
import { inboxCategory } from "./notification-category";
import { NotificationTitle, notificationTitleKey } from "./notification-title";
import { resourceHref } from "./resource-href";

// DOC7-W02, notifications (access addendum §3.4, §4.4): the three DOC-07 kinds
// that reach the Inbox. A manager's row opens the document at the requests
// section; the requester's rows say what happened, and "declined" never names
// the document (the requester never read its title).

const { t } = initI18n();
const KINDS = ["document_access_requested", "document_access_approved", "document_access_declined"] as const;

const workspace = { id: "ws1", slug: "team", organization_id: "o1", organization_slug: "acme" } as Workspace;
const notification = (kind: string, params: Record<string, string> = {}): Notification => ({
  id: "n1", kind, workspace_id: "ws1", organization_id: "o1", resource_type: "document", resource_id: "d1",
  resource_deleted: false, resource_access_lost: false, comment_deleted: false, actor_kind: "human", actor_id: "u2",
  title_key: `notifications.kind.${kind}`, params, count: 1, created_at: "", ...{},
});

describe("DOC-07 notification kinds", () => {
  it.each(KINDS)("registers %s with the documents tone, its own glyph and a triage category", (kind) => {
    expect(NOTIFICATION_KINDS).toContain(kind);
    expect(kindTone(kind)).toBe(moduleTone("documents"));
    expect(kindIcon(kind)).not.toBe(kindIcon("kind_from_a_newer_server"));
  });

  it("files the manager's request under what is asked of you, the answers under updates", () => {
    expect(inboxCategory("document_access_requested")).toBe("mentions");
    expect(inboxCategory("document_access_approved")).toBe("updates");
    expect(inboxCategory("document_access_declined")).toBe("updates");
  });

  it("opens a manager's row at the requests section and the requester's rows at the document", () => {
    const open = (kind: string) => resourceHref(notification(kind), workspace, [workspace]);
    expect(open("document_access_requested")).toBe("/acme/team/documents/d1?access=requests");
    expect(open("document_access_approved")).toBe("/acme/team/documents/d1");
    expect(open("document_access_declined")).toBe("/acme/team/documents/d1");
  });
});

describe("DOC-07 notification sentences", () => {
  const sentence = (n: Notification) => {
    const { container } = render(<NotificationTitle notification={n} unread={false} />);
    return container.textContent;
  };

  it("names actor and document for a request and an approval", () => {
    expect(sentence(notification("document_access_requested", { actor: "Bình", document: "Hợp đồng" }))).toBe(
      t("notifications.kind.document_access_requested", { actor: "Bình", document: "Hợp đồng" }),
    );
    expect(sentence(notification("document_access_approved", { actor: "Chi", document: "Hợp đồng" }))).toBe(
      t("notifications.kind.document_access_approved", { actor: "Chi", document: "Hợp đồng" }),
    );
  });

  it.each(["document_access_requested", "document_access_approved"] as const)(
    "uses the title-less sentence of %s once the name is gone, and it resolves",
    (kind) => {
      const cases: Record<string, string>[] = [{ actor: "Bình" }, { actor: "Bình", document: "" }, { actor: "Bình", document: "  " }];
      for (const params of cases) {
        const n = notification(kind, params);
        expect(notificationTitleKey(n)).toBe(`notifications.kind.${kind}_untitled`);
        const text = sentence(n) ?? "";
        expect(text).not.toBe("");
        expect(text).not.toMatch(/notifications\.kind|\{\{|“\s*”/);
      }
    },
  );

  it("says a request was declined without any document name, whatever the params carry", () => {
    const cases: Record<string, string>[] = [{}, { document: "" }, { document: "Hợp đồng" }];
    for (const params of cases) {
      const n = notification("document_access_declined", params);
      expect(notificationTitleKey(n)).toBe("notifications.kind.document_access_declined");
      const text = sentence(n) ?? "";
      expect(text).toBe(t("notifications.kind.document_access_declined"));
      expect(text).not.toMatch(/notifications\.kind|\{\{/);
    }
  });

  it("has a short title for each kind in both locales", () => {
    for (const kind of KINDS) {
      expect(t(`notifications.kindTitle.${kind}`, { defaultValue: "" })).not.toBe("");
      expect(t(`settings.notifications.kinds.${kind}`, { defaultValue: "" })).not.toBe("");
    }
  });
});
