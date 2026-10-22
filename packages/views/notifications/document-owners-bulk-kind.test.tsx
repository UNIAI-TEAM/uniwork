import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { NOTIFICATION_KINDS, type Notification, type Workspace } from "@uniwork/core/types";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { moduleTone } from "../layout/module-tones";
import { inboxCategory } from "./notification-category";
import { NotificationTitle, notificationTitleKey } from "./notification-title";
import { resourceHref } from "./resource-href";

// S-DOC06b (UNI-2092, access addendum §4.2, §4.4): the grouped notice of a
// bulk transfer. The kind is appended last so the Go kinds_test.go order check
// holds; the row names the source member, not a document.

const KIND = "document_owners_bulk_transferred";
const { t } = initI18n();

const workspace = { id: "ws1", slug: "team", organization_id: "o1", organization_slug: "acme" } as Workspace;
const notification = (params: Record<string, string> = {}): Notification => ({
  id: "n1", kind: KIND, workspace_id: null, organization_id: "o1", resource_type: "organization_member", resource_id: "u9",
  resource_deleted: false, resource_access_lost: false, comment_deleted: false, actor_kind: "human", actor_id: "u2",
  title_key: `notifications.kind.${KIND}`, params, count: 1, created_at: "",
});

const sentence = (n: Notification) => {
  const { container } = render(<NotificationTitle notification={n} unread={false} />);
  return container.textContent;
};

beforeEach(async () => {
  await setLocale("vi");
});

afterEach(async () => {
  cleanup();
  await setLocale("vi");
});

describe("document_owners_bulk_transferred kind", () => {
  it("is the last kind, so the server's ordered list matches", () => {
    expect(NOTIFICATION_KINDS.at(-1)).toBe(KIND);
  });

  it("has the documents tone, its own glyph and files under updates", () => {
    expect(kindTone(KIND)).toBe(moduleTone("documents"));
    expect(kindIcon(KIND)).not.toBe(kindIcon("kind_from_a_newer_server"));
    expect(inboxCategory(KIND)).toBe("updates");
  });

  it("opens the documents home of the open workspace", () => {
    expect(resourceHref(notification(), workspace, [workspace])).toBe("/acme/team/documents");
  });

  it("words the sentence in vi and en as the spec does", async () => {
    const n = notification({ actor: "Bình", name: "An" });
    await setLocale("vi");
    expect(sentence(n)).toBe("Bình đã chuyển cho bạn quyền sở hữu các tài liệu của An.");
    await setLocale("en");
    expect(sentence(n)).toBe("Bình transferred An's documents to you.");
  });

  it("uses a name-less sentence once the member's name is gone, and it resolves", () => {
    const cases: Record<string, string>[] = [{ actor: "Bình" }, { actor: "Bình", name: "" }, { actor: "Bình", name: "  " }];
    for (const params of cases) {
      const n = notification(params);
      expect(notificationTitleKey(n)).toBe(`notifications.kind.${KIND}_untitled`);
      const text = sentence(n) ?? "";
      expect(text).toContain("Bình");
      expect(text).not.toMatch(/notifications\.kind|\{\{|của\s*\./);
    }
  });

  it("has a short title and a settings label in both locales", async () => {
    for (const locale of ["vi", "en"] as const) {
      await setLocale(locale);
      expect(t(`notifications.kindTitle.${KIND}`, { defaultValue: "" }), `${locale} kindTitle`).not.toBe("");
      expect(t(`settings.notifications.kinds.${KIND}`, { defaultValue: "" }), `${locale} settings label`).not.toBe("");
    }
  });
});
