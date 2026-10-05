import { describe, expect, it, vi } from "vitest";
import { canDownloadDocument, createLibraryController, createLibraryScopeController, filterLibraryDocuments } from "./model";
import type { DesktopLibraryDocument } from "../../shared/ipc";

const row = (overrides: Partial<DesktopLibraryDocument> = {}): DesktopLibraryDocument => ({ id: "01J8X4DOC0N1P2Q3R4S5T6U7", workspaceId: "ws-1", title: "Plan.docx", kind: "file", format: "docx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true, ...overrides });

describe("desktop library scope and filtering", () => {
  it("keeps docx, xlsx and pptx rows, drops Work Product and formats the host does not carry", () => {
    const kept = filterLibraryDocuments([
      row(),
      row({ id: "doc-sheet", format: "xlsx", title: "Budget.xlsx" }),
      row({ id: "doc-work", ownerKind: "work_product" }),
      row({ id: "doc-deck", format: "pptx", title: "Deck.pptx" }),
      row({ id: "doc-text", format: "txt" as DesktopLibraryDocument["format"], title: "Notes.txt" }),
    ]);
    expect(kept.map((document) => document.format)).toEqual(["docx", "xlsx", "pptx"]);
  });

  it("keeps every format-table format and drops a foreign one", () => {
    const kept = filterLibraryDocuments([row(), row({ id: "doc-pdf", format: "pdf" }), row({ id: "doc-p", format: "pptx" })]);
    expect(kept.map((document) => document.format)).toEqual(["docx", "pdf", "pptx"]);
    expect(filterLibraryDocuments([row({ id: "doc-t", format: "txt" as never })])).toHaveLength(0);
  });

  it("lists Markdown and HTML documents and drops an unknown format", () => {
    const kept = filterLibraryDocuments([row({ id: "a", format: "md" }), row({ id: "b", format: "html" }), row({ id: "c", format: "txt" as never })]);
    expect(kept.map((document) => document.id)).toEqual(["a", "b"]);
  });

  it("keeps a carried format downloadable while the engine is down", () => {
    expect(canDownloadDocument(row({ format: "pptx" }), false)).toBe(true);
    expect(canDownloadDocument(row({ format: "pdf" }), false)).toBe(true);
    expect(canDownloadDocument(row({ format: "md" }), false)).toBe(true);
    expect(canDownloadDocument(row({ format: "html" }), false)).toBe(true);
    expect(canDownloadDocument(row({ format: "txt" as never }), false)).toBe(false);
    expect(canDownloadDocument(row(), false)).toBe(true);
    expect(canDownloadDocument(row({ format: "xlsx", title: "Budget.xlsx" }), false)).toBe(true);
    expect(canDownloadDocument(row({ downloadAvailable: false }), false)).toBe(false);
  });

  it("clears cache before switching scope and rejects a late response", async () => {
    const clear = vi.fn();
    const scopes = createLibraryScopeController({ deploymentId: "dep-a", accountId: "acct-a", organizationId: "org-a", workspaceId: "ws-a", sessionGeneration: "session_1234" }, clear);
    let resolve!: (value: unknown) => void;
    const bridge = { call: vi.fn(() => new Promise((done) => { resolve = done; })) };
    const controller = createLibraryController(bridge as never, scopes);
    const pending = controller.list();
    scopes.switchScope({ deploymentId: "dep-b", accountId: "acct-b", organizationId: "org-b", workspaceId: "ws-b", sessionGeneration: "session_5678" });
    expect(clear).toHaveBeenCalledOnce();
    resolve({ documents: [row()], nextCursor: null, engineAvailable: true });
    await expect(pending).resolves.toMatchObject({ documents: [], generation: 0 });
    expect(scopes.isCurrent(0)).toBe(false);
  });

  it.each(["list", "recent", "search"] as const)("uses workspace-scoped %s channel", async (mode) => {
    const scopes = createLibraryScopeController({ deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", sessionGeneration: "session_1234" });
    const bridge = { call: vi.fn(async () => ({ documents: [row()], nextCursor: "next", engineAvailable: false })) };
    const controller = createLibraryController(bridge as never, scopes);
    const result = mode === "list" ? await controller.list() : mode === "recent" ? await controller.recent() : await controller.search("plan");
    expect(result.documents).toHaveLength(1);
    expect(bridge.call).toHaveBeenCalledWith(`desktop:library-${mode}`, expect.objectContaining({ workspaceId: "ws" }));
  });
});
