import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Notification } from "@uniwork/core/types";
import { notificationTitleKey, titleParts } from "./notification-title";

describe("titleParts", () => {
  const render = (p: Record<string, string>) => `${p.actor} moved “${p.task}” to ${p.status}`;

  it("splits the rendered sentence into text and the params in the locale's order", () => {
    expect(titleParts(render, { actor: "An", task: "Spec", status: "done" })).toEqual([
      { param: "actor", value: "An" },
      { text: " moved “" },
      { param: "task", value: "Spec" },
      { text: "” to " },
      { param: "status", value: "done" },
    ]);
  });

  it("leaves a sentence without params whole", () => {
    expect(titleParts(() => "Your export is ready", {})).toEqual([{ text: "Your export is ready" }]);
  });
});

const notification = (over: Partial<Notification>): Notification => ({
  id: "n1", kind: "document_commented", workspace_id: "ws1", organization_id: "o1", resource_type: "document",
  resource_id: "d1", resource_deleted: false, resource_access_lost: false, comment_deleted: false,
  actor_kind: "human", actor_id: "u2", title_key: "notifications.kind.document_commented", params: {}, count: 1, created_at: "", ...over,
});

const { t } = initI18n();

// Every document comment, break-glass and access-request kind of server/internal/notification/kinds.go
// whose sentence quotes the document; a declined request never names it (own case below).
const DOCUMENT_KINDS = [
  "document_commented", "document_mentioned", "document_comment_replied",
  "document_discussion_mentioned", "document_discussion_replied", "document_comment_resolved",
  "document_break_glass", "document_access_requested", "document_access_approved", "document_shared",
];

describe("notificationTitleKey", () => {
  it.each(DOCUMENT_KINDS)("keeps the titled sentence of %s while the document name is there", (kind) => {
    const key = `notifications.kind.${kind}`;
    expect(notificationTitleKey(notification({ kind, title_key: key, params: { document: "Kế hoạch", level: "view" } }))).toBe(key);
  });

  it.each(DOCUMENT_KINDS)("uses the title-less variant of %s when the name is missing, empty or blank", (kind) => {
    const key = `notifications.kind.${kind}`;
    const cases: Record<string, string>[] = [{ level: "view" }, { document: "", level: "view" }, { document: "   ", level: "view" }];
    for (const params of cases) {
      expect(notificationTitleKey(notification({ kind, title_key: key, params }))).toBe(`${key}_untitled`);
    }
  });

  // A key the locale lacks would render the raw key in the Inbox, so each title-less variant must resolve.
  it.each(DOCUMENT_KINDS)("has a written sentence for the title-less variant of %s", (kind) => {
    const key = notificationTitleKey(notification({ kind, title_key: `notifications.kind.${kind}`, params: { level: "view" } }));
    expect(t(key, { defaultValue: "" })).not.toBe("");
    expect(t(key, { defaultValue: "" })).not.toMatch(/\{\{document\}\}/);
  });

  it("keeps the one sentence of a declined access request, which never names the document", () => {
    const key = "notifications.kind.document_access_declined";
    const cases: Record<string, string>[] = [{}, { document: "Kế hoạch" }];
    for (const params of cases) {
      expect(notificationTitleKey(notification({ kind: "document_access_declined", title_key: key, params }))).toBe(key);
    }
  });

  it("renders document_break_glass with actor and document name in vi and en", () => {
    const row = notification({
      kind: "document_break_glass",
      title_key: "notifications.kind.document_break_glass",
      params: { actor: "Minh", document: "Báo cáo Q4" },
    });
    expect(t(notificationTitleKey(row), row.params)).toBe(
      "Minh đã mở truy cập khẩn cấp (chỉ xem, 24 giờ) vào tài liệu “Báo cáo Q4”.",
    );
    expect(t(notificationTitleKey({ ...row, params: { actor: "Minh" } }), { actor: "Minh" })).toBe(
      "Minh đã mở truy cập khẩn cấp (chỉ xem, 24 giờ) vào một tài liệu.",
    );
  });

  it("leaves a row of another resource alone, with or without a name", () => {
    const task = notification({ resource_type: "task", kind: "task_assigned", title_key: "notifications.kind.task_assigned" });
    expect(notificationTitleKey(task)).toBe("notifications.kind.task_assigned");
  });

  it("leaves a document row whose key is not a document kind alone", () => {
    const row = notification({ title_key: "notifications.kind.other", params: {} });
    expect(notificationTitleKey(row)).toBe("notifications.kind.other");
  });
});

