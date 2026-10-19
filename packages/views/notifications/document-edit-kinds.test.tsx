import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Bell } from "lucide-react";
import type { Notification, Workspace } from "@uniwork/core/types";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { inboxCategory } from "./notification-category";
import { NotificationTitle, notificationTitleKey } from "./notification-title";
import { resourceHref } from "./resource-href";

// UNI-1645 (addendum §5.2): the three edit-lock kinds in the Inbox.

const workspace = { id: "ws1", slug: "team", organization_id: "o1", organization_slug: "acme" } as Workspace;

const notification = (kind: string, params: Record<string, string> = {}): Notification => ({
  id: "n1", kind, workspace_id: "ws1", organization_id: "o1", resource_type: "document",
  resource_id: "d1", resource_deleted: false, resource_access_lost: false, comment_deleted: false,
  actor_kind: "human", actor_id: "u2", title_key: `notifications.kind.${kind}`,
  params: { actor: "An", document: "Kế hoạch Q4", ...params }, count: 1, created_at: "",
});

const sentence = (n: Notification) => render(<NotificationTitle notification={n} unread={false} />).container.textContent;

describe("document edit-lock notifications", () => {
  it.each([
    ["document_edit_requested", {}, "An muốn sửa “Kế hoạch Q4”"],
    ["document_edit_request_answered", { decision: "accept" }, "An đã nhường quyền sửa “Kế hoạch Q4” cho bạn"],
    ["document_edit_taken_over", {}, "An đã lấy quyền sửa “Kế hoạch Q4”. Thay đổi chưa lưu của bạn vẫn còn trong tài liệu đang mở."],
  ])("renders %s with its own sentence, glyph, tone and category", (kind, params, text) => {
    expect(sentence(notification(kind, params))).toBe(text);
    expect(kindIcon(kind)).not.toBe(Bell);
    expect(kindTone(kind)).toBe(kindTone("document_commented"));
    expect(inboxCategory(kind)).toBe(kind === "document_edit_requested" ? "mentions" : "updates");
  });

  it("reads a declined answer as 'still editing', not 'handed you editing'", () => {
    const declined = notification("document_edit_request_answered", { decision: "decline" });
    expect(notificationTitleKey(declined)).toBe("notifications.kind.document_edit_request_answered_declined");
    expect(sentence(declined)).toBe("An chưa nhả quyền sửa “Kế hoạch Q4”");
    expect(notificationTitleKey(notification("document_edit_request_answered", {}))).toBe("notifications.kind.document_edit_request_answered");
  });

  it("draws a declined answer with a decline glyph, not the accepted one's check (V-3)", () => {
    const accepted = kindIcon("document_edit_request_answered", { decision: "accept" });
    const declined = kindIcon("document_edit_request_answered", { decision: "decline" });
    expect(declined).not.toBe(accepted);
    expect(declined).not.toBe(Bell);
    expect(kindIcon("document_edit_request_answered")).toBe(accepted);
  });

  it("never swaps an edit-lock kind to a title-less sentence the locale does not have", () => {
    const blank = notification("document_edit_taken_over", { document: "" });
    expect(notificationTitleKey(blank)).toBe("notifications.kind.document_edit_taken_over");
  });

  it("opens the holder's request in the editor (?edit_request=), like the push link", () => {
    expect(resourceHref(notification("document_edit_requested", { request_id: "r1" }), workspace, [workspace])).toBe("/acme/team/documents/d1?edit_request=r1");
    expect(resourceHref(notification("document_edit_taken_over"), workspace, [workspace])).toBe("/acme/team/documents/d1");
  });
});
