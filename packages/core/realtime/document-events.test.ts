import { beforeEach, describe, expect, it } from "vitest";
import { readDocumentAccessRequestSentAt, clearDocumentAccessRequestSent } from "../documents/hooks-access-requests";
import { documentKeys } from "../documents/keys";
import { documentFrameKeys } from "./document-events";

// UNI-1645 (contract card (a) §5): lock frames are ids-only and refresh the
// R1 state plus the rows that show a holder - never the document detail, and
// never the org-scoped favourites.

const ws = "ws1";
const frame = { document_id: "d1", workspace_id: ws };
const asJson = (keys: (readonly unknown[])[] | null) => (keys ?? []).map((k) => JSON.stringify(k));

describe("documentFrameKeys - edit lock frames", () => {
  it("document.lock_changed refreshes the lock state and the list, tree, recent and shared roots", () => {
    const keys = documentFrameKeys(ws, "document.lock_changed", frame);
    expect(keys).toEqual([
      documentKeys.editLock(ws, "d1"),
      documentKeys.listRoot(ws),
      documentKeys.treeRoot(ws),
      documentKeys.recent(ws),
      documentKeys.sharedWithMe(ws),
    ]);
  });

  it("document.lock_changed never touches detail, the workspace root or favourites", () => {
    const keys = asJson(documentFrameKeys(ws, "document.lock_changed", frame));
    expect(keys).not.toContain(JSON.stringify(documentKeys.detail(ws, "d1")));
    expect(keys).not.toContain(JSON.stringify(documentKeys.workspace(ws)));
    expect(keys).not.toContain(JSON.stringify(documentKeys.favoritesRoot));
    // No key is a prefix of the detail key, so a prefix invalidation cannot reach it.
    const detail = JSON.stringify(documentKeys.detail(ws, "d1"));
    for (const key of keys) expect(detail.startsWith(key.slice(0, -1))).toBe(false);
  });

  it("the list and tree roots are prefixes of every list and tree entry", () => {
    const list = JSON.stringify(documentKeys.listRoot(ws)).slice(0, -1);
    const tree = JSON.stringify(documentKeys.treeRoot(ws)).slice(0, -1);
    expect(JSON.stringify(documentKeys.list(ws, "q=x")).startsWith(list)).toBe(true);
    expect(JSON.stringify(documentKeys.tree(ws, "f1", true)).startsWith(tree)).toBe(true);
    expect(JSON.stringify(documentKeys.editLock(ws, "d1")).startsWith(JSON.stringify(documentKeys.workspace(ws)).slice(0, -1))).toBe(true);
  });

  it.each(["document.lock_taken_over", "document.edit_requested", "document.edit_request_answered"] as const)(
    "%s refreshes only that document's lock state",
    (type) => {
      expect(documentFrameKeys(ws, type, { ...frame, user_id: "u1", request_id: "r1" })).toEqual([
        documentKeys.editLock(ws, "d1"),
      ]);
    },
  );

  it.each([
    "document.lock_changed",
    "document.lock_taken_over",
    "document.edit_requested",
    "document.edit_request_answered",
  ] as const)("%s from another workspace or without a document id refreshes nothing", (type) => {
    expect(documentFrameKeys(ws, type, { ...frame, workspace_id: "ws2" })).toEqual([]);
    expect(documentFrameKeys(ws, type, { workspace_id: ws })).toEqual([]);
  });
});

// DOC-07 (UNI-1631): the two access-request frames. `requested` is
// workspace-scoped and refreshes the manager's list and the share overview;
// `decided` is user-scoped and refreshes the requester's own document (the
// locked card follows `detail`) while dropping the "sent" device flag.
describe("documentFrameKeys - access request frames", () => {
  const SENT_FLAG = "uniwork_document_access_request_sent:d1";

  beforeEach(() => {
    localStorage.clear();
  });

  it("document.access_requested refreshes the pending list and the share overview", () => {
    expect(documentFrameKeys(ws, "document.access_requested", { ...frame, request_id: "r1" })).toEqual([
      documentKeys.accessRequests(ws, "d1"),
      documentKeys.shares(ws, "d1"),
    ]);
  });

  it("document.access_request_decided refreshes detail and drops the sent flag", () => {
    localStorage.setItem(SENT_FLAG, String(Date.now() + 3600_000));
    expect(readDocumentAccessRequestSentAt("d1")).not.toBeNull();

    const keys = documentFrameKeys(ws, "document.access_request_decided", { ...frame, request_id: "r1", user_id: "u1" });
    expect(keys).toEqual([documentKeys.detail(ws, "d1")]);
    expect(readDocumentAccessRequestSentAt("d1")).toBeNull();
  });

  it("document.access_requested from another workspace or without a document id refreshes nothing", () => {
    expect(documentFrameKeys(ws, "document.access_requested", { ...frame, workspace_id: "ws2" })).toEqual([]);
    expect(documentFrameKeys(ws, "document.access_requested", { workspace_id: ws })).toEqual([]);
  });

  it("document.access_request_decided without a document id refreshes nothing and clears no flag", () => {
    localStorage.setItem(SENT_FLAG, String(Date.now() + 3600_000));
    expect(documentFrameKeys(ws, "document.access_request_decided", { workspace_id: ws })).toEqual([]);
    expect(readDocumentAccessRequestSentAt("d1")).not.toBeNull();
  });

  it("leaves every other topic untouched", () => {
    expect(documentFrameKeys(ws, "document.access_request_answered", frame)).toBeNull();
    expect(documentFrameKeys(ws, "task.updated", frame)).toBeNull();
  });
});
