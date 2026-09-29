import { describe, expect, it } from "vitest";
import { officeCapabilityEntrySchema, officeIdentitySchema, officeSaveIntentSchema, officeSaveReceiptSchema } from "./host-contract";

const identity = {
  deploymentId: "dep-1",
  accountId: "acct-1",
  organizationId: "org-1",
  workspaceId: "ws-1",
  documentId: "doc-1",
  generation: 4,
  baseVersionId: "01J8Z0V0000000000000000A",
  baseRevision: "9007199254740993",
};

describe("Office Editor Host v1 contract", () => {
  it("accepts revisions beyond JavaScript's safe integer range as strings", () => {
    expect(officeIdentitySchema.parse(identity).baseRevision).toBe("9007199254740993");
    expect(() => officeIdentitySchema.parse({ ...identity, baseRevision: 42 })).toThrow();
  });

  it("normalizes unknown capability status to unknown", () => {
    expect(officeCapabilityEntrySchema.parse({
      format: "md",
      operation: "serialize",
      host: "web",
      engineBuild: "engine-1",
      contractRevision: "office-editor-host/1",
      status: "future",
    }).status).toBe("unknown");
  });

  it("requires intent identity and receipt correlation", () => {
    const intent = officeSaveIntentSchema.parse({
      intentId: "intent-1",
      idempotencyKey: "key-1",
      identity,
      snapshotGeneration: 5,
      snapshotFingerprint: "fp-1",
      snapshot: { text: "draft" },
      operation: "manual_save",
      createdAt: 10,
    });
    expect(intent.identity.baseRevision).toBe(identity.baseRevision);
    expect(officeSaveReceiptSchema.parse({
      intentId: "intent-1",
      idempotencyKey: "key-1",
      documentId: "doc-1",
      versionId: "version-1",
      revision: "9007199254740994",
      checksumSha256: "sha",
      sizeBytes: 12,
      engineName: "genoffice",
      engineVersion: "engine-1",
      contractVersion: "contract-1",
      protocolVersion: "1",
    }).revision).toBe("9007199254740994");
  });
});
