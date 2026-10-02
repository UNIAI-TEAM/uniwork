import { describe, expect, it } from "vitest";
import type { DraftIdentity, DraftSession } from "../../../packages/core/office/draft-recovery";
import { createOpenedDocuments } from "./opened-documents";

const identity = (documentId: string): DraftIdentity => ({ deploymentId: "dep", accountId: "account-a", organizationId: "org", workspaceId: "ws", documentId, base: { version: "1", revision: "1" } });
const session: DraftSession = { sessionId: "session", deploymentId: "dep", accountId: "account-a", generation: 1 };

describe("main-owned open documents", () => {
  it("preserves inactive contexts and removes closed documents without allowing resurrection", () => {
    const closed: string[] = [];
    const docs = createOpenedDocuments({ session: () => session, onClosed: (id) => closed.push(id) });
    docs.open("a", "cloud", identity("a"));
    docs.open("b", "cloud", identity("b"));
    expect(docs.update({ documentIds: ["a", "b"], activeDocumentId: "b" })).toBe(true);
    expect(docs.context("a")?.identity.documentId).toBe("a");
    expect(docs.activeDocumentId()).toBe("b");
    expect(docs.update({ documentIds: ["b"], activeDocumentId: null })).toBe(true);
    expect(docs.activeDocumentId()).toBeUndefined();
    expect(docs.context("a")).toBeUndefined();
    expect(closed).toEqual(["a"]);
    expect(docs.update({ documentIds: ["a", "b"], activeDocumentId: "a" })).toBe(false);
    expect(docs.context("b")).toBeDefined();
  });

  it("rejects invalid tab sets atomically and keeps the eight-document limit", () => {
    const docs = createOpenedDocuments({ session: () => session });
    for (let n = 0; n < 8; n++) expect(docs.open(String(n), "cloud", identity(String(n)))).toBe(true);
    expect(docs.open("8", "cloud", identity("8"))).toBe(false);
    expect(docs.update({ documentIds: ["0", "0"], activeDocumentId: "0" })).toBe(false);
    expect(docs.update({ documentIds: ["0"], activeDocumentId: "1" })).toBe(false);
    expect(docs.update({ documentIds: ["unknown"], activeDocumentId: null })).toBe(false);
    expect(docs.all()).toHaveLength(8);
  });

  it("clears all context and active state on account or generation changes", () => {
    let live = session;
    const docs = createOpenedDocuments({ session: () => live });
    docs.open("a", "cloud", identity("a"));
    docs.update({ documentIds: ["a"], activeDocumentId: "a" });
    live = { ...session, accountId: "account-b" };
    expect(docs.context("a")).toBeUndefined();
    expect(docs.activeDocumentId()).toBeUndefined();
    expect(docs.open("a", "cloud", identity("a"), session)).toBe(false);
    live = { ...session, generation: 2 };
    expect(docs.open("a", "cloud", identity("a"), session)).toBe(false);
    expect(docs.open("a", "cloud", identity("a"))).toBe(true);
    live = { ...session, generation: 3 };
    expect(docs.all()).toEqual([]);
  });

  it("resolves local handles separately from restart-stable draft ids and preserves existing base", () => {
    const docs = createOpenedDocuments({ session: () => session });
    docs.open("file_handle", "local", identity("local:hash"));
    docs.open("file_handle", "local", { ...identity("local:hash"), base: { version: "2", revision: "2" } });
    expect(docs.context("file_handle")?.identity).toEqual(identity("local:hash"));
    expect(docs.context("local:hash")).toBeUndefined();
    docs.clear();
    expect(docs.all()).toEqual([]);
  });
});
