import { describe, expect, it, vi } from "vitest";
import { createFakeOfficeTransport } from "./test-fakes";
import { createOfficeSaveCoordinator } from "./save-coordinator";
import type { DraftAdapter, EditorHandle, OfficeIdentity, OfficeSaveIntent, OfficeSaveReceipt } from "./host-contract";

// T09 (W15 review F2-scope): when the transport's per-intent hold (the pptx
// undo hold, retained serialized bytes, an xlsx commit candidate) ends.

const identity: OfficeIdentity = {
  deploymentId: "dep-1", accountId: "acct-1", organizationId: "org-1", workspaceId: "ws-1",
  documentId: "doc-1", generation: 1, baseVersionId: "version-1", baseRevision: "8",
};

type Format = "docx" | "xlsx" | "pptx";

/** What each format's commit step throws after the provider may have taken
 *  the bytes (a host-side receipt check or the post-commit rebase). */
const POST_COMMIT_THROWS: Record<Format, readonly unknown[]> = {
  docx: [new Error("docx_commit_receipt_mismatch"), Object.assign(new Error("local_save_checksum_mismatch"), { code: "local_save_checksum_mismatch" }), new Error("save_unconfirmed")],
  xlsx: [new Error("commit_checksum_mismatch"), new Error("xlsx_commit_candidate_missing"), Object.assign(new Error("office_receipt_mismatch"), { code: "office_receipt_mismatch" })],
  pptx: [new Error("pptx_commit_receipt_mismatch"), Object.assign(new Error("pptx_commit_candidate_missing"), { code: "pptx_commit_candidate_missing" }), Object.assign(new Error("pptx_save_rebase_diverged"), { code: "pptx_save_rebase_diverged" })],
};

const BLOCKED: readonly { code: string; status: number }[] = [
  { code: "quota_exceeded", status: 413 },
  { code: "file_too_large", status: 413 },
  { code: "forbidden", status: 403 },
  { code: "unauthorized", status: 401 },
  { code: "document_deleted", status: 410 },
];

function harness(format: Format) {
  let dirty = 0;
  let revision = 8n;
  let ids = 0;
  const editor: EditorHandle<{ text: string }> = {
    format, open: vi.fn(async () => undefined), dispose: vi.fn(),
    getDirtyGeneration: () => dirty,
    captureSnapshot: vi.fn(async () => ({ generation: dirty, fingerprint: `fp-${dirty}`, value: { text: `edit-${dirty}` } })),
  };
  const intents: OfficeSaveIntent<{ text: string }>[] = [];
  const draft: DraftAdapter<{ text: string }> = {
    checkpoint: vi.fn(async () => undefined), recover: vi.fn(async () => null), discard: vi.fn(async () => undefined),
    persistIntent: vi.fn(async (intent: OfficeSaveIntent<{ text: string }>) => { intents.push(intent); }),
    loadIntent: vi.fn(async () => null), clearIntent: vi.fn(async () => undefined),
  };
  const transport = createFakeOfficeTransport<{ text: string }>();
  transport.serializedOutput = { data: new Uint8Array([1]), checksumSha256: "sha", sizeBytes: 1, format };
  const receiptFor = (intent: OfficeSaveIntent<{ text: string }>): OfficeSaveReceipt => {
    revision += 1n;
    return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: intent.identity.documentId, versionId: `version-${revision}`, revision: revision.toString(), checksumSha256: "sha", sizeBytes: 1, engineName: "genoffice", engineVersion: "1", contractVersion: "1", protocolVersion: "1" };
  };
  transport.commit = vi.fn(async ({ intent }) => receiptFor(intent));
  transport.release = vi.fn(async () => undefined);
  const coordinator = createOfficeSaveCoordinator({ identity, editor, draft, transport, idFactory: (prefix) => `${prefix}-${++ids}`, now: () => 1, backoffMs: [0] });
  return { coordinator, transport, intents, receiptFor, edit: () => { dirty += 1; coordinator.markDirty(dirty); } };
}

describe.each(["docx", "xlsx", "pptx"] as const)("%s Save transport release (T09)", (format) => {
  it("keeps the hold after a commit-step throw that may follow a landed write", async () => {
    for (const thrown of POST_COMMIT_THROWS[format]) {
      const h = harness(format);
      h.transport.commit = vi.fn(async () => { throw thrown; });
      h.edit();
      await expect(h.coordinator.save()).resolves.toEqual({ accepted: false, reason: "error" });
      // The intent is settled (no silent retry of the same bytes) ...
      expect(h.coordinator.getState()).toMatchObject({ state: "error", activeIntentId: null });
      // ... but its prefix may be on the server: the hold stays.
      expect(h.transport.release).not.toHaveBeenCalled();
    }
  });

  it("keeps the hold when the commit landed after the session moved on", async () => {
    const h = harness(format);
    let finish!: () => void;
    h.transport.commit = vi.fn(({ intent }) => new Promise((resolve) => { finish = () => resolve(h.receiptFor(intent)); }));
    h.edit();
    const saving = h.coordinator.save();
    await vi.waitFor(() => expect(h.transport.commit).toHaveBeenCalledOnce());
    h.coordinator.setIdentity({ ...identity, generation: 2 });
    finish();
    await expect(saving).resolves.toEqual({ accepted: false, reason: "error" });
    expect(h.transport.release).not.toHaveBeenCalled();
  });

  it("still releases after a pre-commit throw and after a server refusal of the commit", async () => {
    const serialize = harness(format);
    serialize.transport.serialize = vi.fn(async () => { throw new Error(`${format}_serialized_output_invalid`); });
    serialize.edit();
    await serialize.coordinator.save();
    expect(serialize.transport.release).toHaveBeenCalledExactlyOnceWith({ intent: serialize.intents[0] });

    for (const refusal of [{ code: "idempotency_payload_mismatch", status: 409 }, { code: "revision_conflict", status: 409 }]) {
      const h = harness(format);
      h.transport.commit = vi.fn(async () => { throw refusal; });
      h.edit();
      await h.coordinator.save();
      expect(h.transport.release).toHaveBeenCalledExactlyOnceWith({ intent: h.intents[0] });
    }
  });

  it("releases the hold at once on a blocked refusal and keeps the intent for Retry", async () => {
    for (const blocked of BLOCKED) {
      const h = harness(format);
      h.transport.commit = vi.fn(async () => { throw blocked; });
      h.edit();
      await expect(h.coordinator.save()).resolves.toEqual({ accepted: false, reason: "blocked" });
      expect(h.coordinator.getState()).toMatchObject({ state: "blocked", activeIntentId: h.intents[0]?.intentId });
      expect(h.transport.release).toHaveBeenCalledExactlyOnceWith({ intent: h.intents[0] });
    }
  });

  it("retries a released intent as a fresh intent from the current content", async () => {
    const h = harness(format);
    h.transport.commit = vi.fn(async () => { throw { code: "quota_exceeded", status: 413 }; });
    h.edit();
    await h.coordinator.save();
    // The user undoes/edits after the refusal: the old snapshot is gone.
    h.edit();
    h.transport.commit = vi.fn(async ({ intent }) => h.receiptFor(intent));
    await expect(h.coordinator.retry()).resolves.toMatchObject({ accepted: true });
    expect(h.transport.reconcileCalls).toBe(0);
    expect(h.intents).toHaveLength(2);
    expect(h.intents[1]).toMatchObject({ snapshotGeneration: 2, snapshot: { text: "edit-2" } });
    expect(h.intents[1]?.idempotencyKey).not.toBe(h.intents[0]?.idempotencyKey);
    expect(h.transport.release).toHaveBeenCalledOnce();
    expect(h.coordinator.getState()).toMatchObject({ state: "saved", activeIntentId: null, identity: { baseRevision: "9" } });
  });

  it("keeps an ambiguous outcome pending with its hold", async () => {
    const h = harness(format);
    h.transport.commit = vi.fn(async () => { throw { code: "engine_timeout", status: 504 }; });
    h.transport.reconcile = vi.fn(async () => null);
    h.edit();
    await h.coordinator.save();
    expect(h.coordinator.getState().activeIntentId).toBe(h.intents[0]?.intentId);
    expect(h.transport.release).not.toHaveBeenCalled();
  });
});
