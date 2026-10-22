import { describe, expect, it } from "vitest";
import { canShareDocumentForChat, type ChatShareableDocumentRow } from "./chat-document-share-gate";

const row = (over: Partial<ChatShareableDocumentRow> = {}): ChatShareableDocumentRow => ({
  kind: "file",
  my_level: "manage",
  ...over,
});

describe("canShareDocumentForChat", () => {
  it("lists a document the sender manages, file or page", () => {
    expect(canShareDocumentForChat(row())).toBe(true);
    expect(canShareDocumentForChat(row({ kind: "page" }))).toBe(true);
  });

  it("lists a row the sender only administers through admin_scope, whatever level it carries", () => {
    expect(canShareDocumentForChat(row({ my_level: "", admin_scope: true }))).toBe(true);
    expect(canShareDocumentForChat(row({ my_level: "view", admin_scope: true }))).toBe(true);
    expect(canShareDocumentForChat(row({ my_level: null, admin_scope: true }))).toBe(true);
  });

  it("drops what the sender cannot administer: edit, comment, view, no level, a false admin_scope", () => {
    for (const my_level of ["edit", "comment", "view", "", null, undefined] as const) {
      expect(canShareDocumentForChat(row({ my_level })), String(my_level)).toBe(false);
    }
    expect(canShareDocumentForChat(row({ my_level: "edit", admin_scope: false }))).toBe(false);
  });

  it("drops folders and the My Folder system row, even at manage", () => {
    expect(canShareDocumentForChat(row({ kind: "folder" }))).toBe(false);
    expect(canShareDocumentForChat(row({ kind: "folder", system_kind: "my_folder" }))).toBe(false);
    expect(canShareDocumentForChat(row({ system_kind: "my_folder" }))).toBe(false);
  });

  it("drops an owned (work-product) document: its access is delegated to the task or meeting", () => {
    expect(canShareDocumentForChat(row({ owner_kind: "work_product" }))).toBe(false);
  });

  it("drops archived and shelved documents", () => {
    expect(canShareDocumentForChat(row({ archived_at: "2026-10-01T00:00:00Z" }))).toBe(false);
    expect(canShareDocumentForChat(row({ shelved_at: "2026-10-01T00:00:00Z" }))).toBe(false);
    expect(canShareDocumentForChat(row({ archived_at: null, shelved_at: null }))).toBe(true);
  });
});
