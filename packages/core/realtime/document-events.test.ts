import { describe, expect, it } from "vitest";
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
