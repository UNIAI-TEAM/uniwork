import { describe, expect, it, vi } from "vitest";
import { canDownloadDocument, createLibraryController, createLibraryScopeController, filterLibraryDocuments } from "./model";
import type { DesktopLibraryDocument } from "../../shared/ipc";

const row = (overrides: Partial<DesktopLibraryDocument> = {}): DesktopLibraryDocument => ({ id: "01J8X4DOC0N1P2Q3R4S5T6U7", workspaceId: "ws-1", title: "Plan.docx", kind: "file", format: "docx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true, ...overrides });

describe("desktop library scope and filtering", () => {
  it("removes Work Product and unknown formats before rendering", () => {
    expect(filterLibraryDocuments([row(), row({ id: "doc-work", ownerKind: "work_product" }), row({ id: "doc-x", format: "docx" })])).toHaveLength(2);
  });

  it("keeps DOCX download available while the engine is down", () => {
    expect(canDownloadDocument(row(), false)).toBe(true);
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
