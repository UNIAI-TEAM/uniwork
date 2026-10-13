import { describe, expect, it } from "vitest";
import type { Notification } from "@uniwork/core/types";
import { notificationSnippet, plainSnippet } from "./notification-snippet";

const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";

describe("plainSnippet", () => {
  it("reads every mention token as the name written in it", () => {
    expect(plainSnippet(`[@An](mention://member/${ID}) và [@Bình](mention://member/${ID.toLowerCase()}) xem`)).toBe("@An và @Bình xem");
  });

  it("unescapes a label and folds whitespace onto one line", () => {
    expect(plainSnippet(`  Nhờ [@Hà \\[QA\\]](mention://member/${ID})\n\nxem  `)).toBe("Nhờ @Hà [QA] xem");
  });

  it.each([
    ["Nhờ [@Lê Thu…", "Nhờ @Lê Thu…"],
    ["Nhờ [@Lê Thu](…", "Nhờ @Lê Thu…"],
    ["Nhờ [@Lê Thu](mention://mem…", "Nhờ @Lê Thu…"],
  ])("still reads a token the snippet bound cut as a name: %s", (raw, plain) => {
    expect(plainSnippet(raw)).toBe(plain);
  });

  it("leaves text that only looks like a link alone", () => {
    expect(plainSnippet("[@An](https://x.test) and <b>x</b>")).toBe("[@An](https://x.test) and <b>x</b>");
  });
});

describe("notificationSnippet", () => {
  const base = {
    resource_type: "document", resource_access_lost: false, resource_deleted: false, comment_deleted: false,
    params: { snippet: "Xem giúp", kind: "comment" },
  } as unknown as Notification;

  it("is the plain snippet of a readable document comment", () => {
    expect(notificationSnippet(base)).toEqual({ kind: "text", text: "Xem giúp" });
  });

  it("is nothing for a lost or gone document, or a row of another resource", () => {
    expect(notificationSnippet({ ...base, resource_access_lost: true })).toBeNull();
    expect(notificationSnippet({ ...base, resource_deleted: true, comment_deleted: true })).toBeNull();
    expect(notificationSnippet({ ...base, resource_type: "task" })).toBeNull();
    expect(notificationSnippet({ ...base, params: { kind: "comment" } })).toBeNull();
  });

  it("names a deleted comment by its kind", () => {
    expect(notificationSnippet({ ...base, comment_deleted: true })).toEqual({ kind: "deleted", key: "documents.collab.collabCommentDeleted" });
    expect(notificationSnippet({ ...base, comment_deleted: true, params: { kind: "discussion" } })).toEqual({
      kind: "deleted", key: "documents.collab.collabDiscussionDeleted",
    });
  });
});
