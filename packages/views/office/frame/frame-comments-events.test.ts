import { describe, expect, it } from "vitest";
import { commentsChangedDocument, frameCanShareView, frameCommentsLevel } from "./frame-comments-events";

const frame = (type: string, payload: unknown) => ({ type, payload });

describe("commentsChangedDocument (contract-collab §7)", () => {
  it.each([
    "document.comment_added",
    "document.comment_updated",
    "document.comment_deleted",
    "document.comment_resolved",
    "document.comment_unresolved",
    "document.comment_reaction_added",
    "document.comment_reaction_removed",
    "document.comment_anchors_updated",
  ])("%s for this document and workspace becomes comments.changed for that document", (type) => {
    expect(commentsChangedDocument(frame(type, { document_id: "d1", workspace_id: "ws-1", comment_id: "c1" }), "ws-1", "d1")).toBe("d1");
  });

  it("the anchors event names a version, not a comment, and still maps", () => {
    expect(commentsChangedDocument(frame("document.comment_anchors_updated", { document_id: "d1", workspace_id: "ws-1", version_id: "v2" }), "ws-1", "d1")).toBe("d1");
  });

  it("another document's comment frame maps to nothing", () => {
    expect(commentsChangedDocument(frame("document.comment_added", { document_id: "d2", workspace_id: "ws-1" }), "ws-1", "d1")).toBeNull();
  });

  it("another workspace's frame maps to nothing, even for the same document id", () => {
    expect(commentsChangedDocument(frame("document.comment_added", { document_id: "d1", workspace_id: "ws-2" }), "ws-1", "d1")).toBeNull();
  });

  it("a frame without a workspace id still maps by document (the realtime sync guard accepts it too)", () => {
    expect(commentsChangedDocument(frame("document.comment_deleted", { document_id: "d1" }), "ws-1", "d1")).toBe("d1");
  });

  it("an event that is not a comment event maps to nothing", () => {
    expect(commentsChangedDocument(frame("document.updated", { document_id: "d1", workspace_id: "ws-1" }), "ws-1", "d1")).toBeNull();
    expect(commentsChangedDocument(frame("task.updated", { document_id: "d1" }), "ws-1", "d1")).toBeNull();
  });

  it.each([null, undefined, "x", 3, [], {}, { document_id: 5 }])("a malformed payload %j maps to nothing", (payload) => {
    expect(commentsChangedDocument(frame("document.comment_added", payload), "ws-1", "d1")).toBeNull();
  });
});

describe("frameCommentsLevel (OQ-C12)", () => {
  it("is the document's own level when the page knows it", () => {
    expect(frameCommentsLevel({ myLevel: "view", readonly: false, canEdit: true })).toBe("view");
    expect(frameCommentsLevel({ myLevel: "comment", readonly: false, canEdit: true })).toBe("comment");
    expect(frameCommentsLevel({ myLevel: "edit", readonly: false, canEdit: true })).toBe("edit");
    expect(frameCommentsLevel({ myLevel: "manage", readonly: false, canEdit: true })).toBe("manage");
  });

  it("a read-only page never grants more than view, whatever the document says", () => {
    expect(frameCommentsLevel({ myLevel: "manage", readonly: true, canEdit: true })).toBe("view");
    expect(frameCommentsLevel({ myLevel: "edit", readonly: true, canEdit: true })).toBe("view");
  });

  it("without a level, an editor token reads edit and anything else view (never manage)", () => {
    expect(frameCommentsLevel({ myLevel: null, readonly: false, canEdit: true })).toBe("edit");
    expect(frameCommentsLevel({ myLevel: undefined, readonly: false, canEdit: false })).toBe("view");
    expect(frameCommentsLevel({ myLevel: undefined, readonly: false, canEdit: undefined })).toBe("view");
  });

  it("a level the client does not know, or an empty one, never maps upward: view, whatever the token says", () => {
    expect(frameCommentsLevel({ myLevel: "owner", readonly: false, canEdit: true })).toBe("view");
    expect(frameCommentsLevel({ myLevel: "", readonly: false, canEdit: true })).toBe("view");
  });
});

describe("frameCanShareView (G8-18)", () => {
  it("is on for manage only, and never on a read-only page", () => {
    expect(frameCanShareView("manage", false)).toBe(true);
    expect(frameCanShareView("manage", true)).toBe(false);
    for (const level of ["view", "comment", "edit"] as const) expect(frameCanShareView(level, false)).toBe(false);
  });
});
