import { describe, expect, it } from "vitest";
import type { DesktopDraftStore } from "./drafts/store";
import { createDocumentLeaveEvidence, leaveScope } from "./document-leave";
import { createOpenedDocuments } from "./opened-documents";
import type { DraftIdentity, DraftSession } from "../../../packages/core/office/draft-recovery";

const accountSession: DraftSession = { sessionId: "session", deploymentId: "dep", accountId: "account", generation: 1 };
const deviceSession: DraftSession = { sessionId: "session", deploymentId: "local-device", accountId: "local:device", generation: 1 };
const cloudIdentity: DraftIdentity = { deploymentId: "dep", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "cloud-1", base: { revision: "1", version: "v1" } };
const localIdentity: DraftIdentity = { deploymentId: "local-device", accountId: "local:device", organizationId: "local", workspaceId: "local", documentId: "local:hash", base: { revision: "1", version: "v1" } };

function fixture() {
  const documents = createOpenedDocuments({ sessionFor: (kind) => kind === "local" ? deviceSession : accountSession });
  documents.open("cloud-1", "cloud", cloudIdentity);
  documents.open("file_1", "local", localIdentity);
  // A failed checkpoint on the local document is invisible to a logout.
  documents.beginCheckpoint("file_1")(false);
  const store = { list: async () => [] } as unknown as DesktopDraftStore;
  return { documents, evidence: createDocumentLeaveEvidence({ documents, store, saveBusy: () => false }) };
}

describe("leave evidence scoped by reason", () => {
  it("ignores surviving local-device documents for logout and covers them for close/update", async () => {
    const { documents, evidence } = fixture();
    expect(leaveScope(documents, "logout").map((document) => document.kind)).toEqual(["cloud"]);
    expect(leaveScope(documents, "close")).toHaveLength(2);
    expect(leaveScope(documents, "update")).toHaveLength(2);

    evidence.capture("logout");
    await expect(evidence.confirmKeep()).resolves.toBe(true);
    await expect(evidence.confirmDiscard()).resolves.toBe(true);

    evidence.capture("close");
    await expect(evidence.confirmKeep()).resolves.toBe(false);
    // Discard tolerates a failed checkpoint and requires no row.
    await expect(evidence.confirmDiscard()).resolves.toBe(true);

    evidence.capture("update");
    await expect(evidence.confirmSave(0)).resolves.toBe(false);
  });

  it("still verifies cloud documents for logout", async () => {
    const { documents } = fixture();
    documents.beginCheckpoint("cloud-1")(false);
    const store = { list: async () => [] } as unknown as DesktopDraftStore;
    const evidence = createDocumentLeaveEvidence({ documents, store, saveBusy: () => false });
    evidence.capture("logout");
    await expect(evidence.confirmKeep()).resolves.toBe(false);
  });
});
