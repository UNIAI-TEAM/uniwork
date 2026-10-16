import { describe, expect, it } from "vitest";
import type { Notification, Workspace } from "@uniwork/core/types";
import { resourceHref } from "./resource-href";

const workspace = { id: "ws1", slug: "team", organization_id: "o1", organization_slug: "acme" } as Workspace;
const sales = { id: "ws2", slug: "sales", organization_id: "o1", organization_slug: "acme" } as Workspace;
// One typed factory: every case names only what it varies, and the document flags default to false.
const notification = (over: Partial<Notification>): Notification => ({
  id: "n1", kind: "chat_follow_up", workspace_id: "ws1", organization_id: "o1", resource_type: "chat_message",
  resource_id: "m1", resource_deleted: false, resource_access_lost: false, comment_deleted: false,
  actor_kind: "human", actor_id: "u2", title_key: "", params: {}, count: 1, created_at: "", ...over,
});

describe("resourceHref", () => {
  it("opens a chat message in its room, scrolled to it", () => {
    const n = notification({ resource_type: "chat_message", resource_id: "m1", resource_parent_id: "r1" });
    expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/chat?room=r1&message=m1");
  });

  it("falls back to Chat when the room is unknown", () => {
    const n = notification({ resource_type: "chat_message", resource_id: "m1" });
    expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/chat");
  });

  it("opens a meeting's summary panel from the summary reminder", () => {
    const n = notification({ kind: "meeting_summary_reminder", resource_type: "meeting", resource_id: "m1" });
    expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/meetings/m1?section=summary");
  });

  it("opens other meeting notifications at the top of the page", () => {
    const n = notification({ kind: "meeting_invited", resource_type: "meeting", resource_id: "m1" });
    expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/meetings/m1");
  });

  // The three vectors shared with the push link (contract G8-07 §2); the server
  // test asserts the same paths behind its origin.
  describe("document comments", () => {
    const doc = notification({
      kind: "document_commented", resource_type: "document", resource_id: "d1",
      params: { comment_id: "c1", kind: "comment" },
    });

    it("opens in the notification's workspace when the recipient is a member", () => {
      const n = { ...doc, workspace_id: "ws2" };
      expect(resourceHref(n, workspace, [workspace, sales])).toBe("/acme/sales/documents/d1?comment=c1");
    });

    it("falls back to the open workspace for a document shared from a workspace the recipient is not in", () => {
      const n = { ...doc, workspace_id: "ws9" };
      expect(resourceHref(n, workspace, [workspace, sales])).toBe("/acme/team/documents/d1?comment=c1");
    });

    // Push answers /workspaces here: it has no open workspace to fall back on.
    it("falls back to the open workspace when the recipient has no workspace in that organization", () => {
      const n = { ...doc, workspace_id: "ws7", organization_id: "o2" };
      expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/documents/d1?comment=c1");
    });

    it("opens the open workspace before the workspace list has loaded", () => {
      const n = { ...doc, workspace_id: "ws2" };
      expect(resourceHref(n, workspace, [])).toBe("/acme/team/documents/d1?comment=c1");
    });

    it("opens the document alone when the notification names no comment", () => {
      const n = { ...doc, params: {} };
      expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/documents/d1");
    });

    // The kind rides only for a discussion post: the tab to open when the post is gone (V7 F3).
    it("adds the kind to a discussion post's link and to nothing else", () => {
      const post = { ...doc, params: { comment_id: "c1", kind: "discussion" } };
      expect(resourceHref(post, workspace, [workspace])).toBe("/acme/team/documents/d1?comment=c1&kind=discussion");
      const others: Record<string, string>[] = [{ comment_id: "c1", kind: "comment" }, { comment_id: "c1" }, { comment_id: "c1", kind: "x" }];
      for (const params of others) {
        const n = { ...doc, params };
        expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/documents/d1?comment=c1");
      }
    });

    it("escapes the comment id", () => {
      const n = { ...doc, params: { comment_id: "c 1&x" } };
      expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/documents/d1?comment=c+1%26x");
    });

    it("opens the document access panel on break-glass for document_break_glass notifications", () => {
      const n = notification({
        kind: "document_break_glass",
        resource_type: "document",
        resource_id: "d1",
        workspace_id: "ws1",
      });
      expect(resourceHref(n, workspace, [workspace])).toBe("/acme/team/documents/d1?access=break_glass");
    });
  });

  // Web link == push link. Every input and expected path below is a vector of
  // server/internal/notification/document_comments_test.go TestResourceURLDocumentVectors
  // (same slugs, document and comment ids); the Go test asserts the same paths behind
  // "https://app.test". Change one side and this test, or that one, fails.
  describe("web link equals the push link (TestResourceURLDocumentVectors)", () => {
    const DOC = "01J8X4DOC0000000000000000A";
    const COMMENT = "01J8X4CMTN1P2Q3R4S5T6U7V";
    const notifWs = { id: "w-notif-ws", slug: "notif-ws", organization_id: "o-notif", organization_slug: "notif-org" } as Workspace;
    const notifWs2 = { id: "w-notif-ws-2", slug: "notif-ws-2", organization_id: "o-notif", organization_slug: "notif-org" } as Workspace;
    const elsewhere = { id: "w-else", slug: "else-ws", organization_id: "o-else", organization_slug: "else-org" } as Workspace;
    // The Go fixture's notification: always the document's own workspace (notif-ws), whoever the recipient is.
    const mention = (params: Record<string, string>) => notification({
      kind: "document_mentioned", resource_type: "document", resource_id: DOC,
      workspace_id: notifWs.id, organization_id: "o-notif", params,
    });
    const commentParams = { comment_id: COMMENT, kind: "comment" };

    it("vector 1: recipient is a member of the notification's workspace", () => {
      expect(resourceHref(mention(commentParams), notifWs, [notifWs])).toBe(`/notif-org/notif-ws/documents/${DOC}?comment=${COMMENT}`);
    });

    it("vector 2: shared from another workspace, recipient reads it there", () => {
      // The recipient belongs to notif-ws-2 only, so that is their open workspace and their whole list.
      expect(resourceHref(mention(commentParams), notifWs2, [notifWs2])).toBe(`/notif-org/notif-ws-2/documents/${DOC}?comment=${COMMENT}`);
    });

    // The deliberate difference: push has no open workspace and answers /workspaces; the web
    // always has one, so the link lands on the document there and the page decides.
    it("vector 3: recipient has no workspace in the document's organization (push: /workspaces, web: the open workspace)", () => {
      const pushPath = "/workspaces";
      const web = resourceHref(mention(commentParams), elsewhere, [elsewhere]);
      expect(web).toBe(`/else-org/else-ws/documents/${DOC}?comment=${COMMENT}`);
      expect(web).not.toBe(pushPath);
    });

    it("a discussion thread appends kind=discussion", () => {
      const params = { comment_id: COMMENT, kind: "discussion" };
      expect(resourceHref(mention(params), notifWs, [notifWs])).toBe(`/notif-org/notif-ws/documents/${DOC}?comment=${COMMENT}&kind=discussion`);
    });

    it("no comment id opens the bare document", () => {
      expect(resourceHref(mention({}), notifWs, [notifWs])).toBe(`/notif-org/notif-ws/documents/${DOC}`);
    });
  });
});
