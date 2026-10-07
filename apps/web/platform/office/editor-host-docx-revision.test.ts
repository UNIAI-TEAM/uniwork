// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle, type DocxTiptapSnapshot } from "@uniwork/views/office/docx";
import type { OfficeIdentity, OfficeSaveTransport } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createOfficeEditorSession } from "./editor-host-core";
import { docxWithRevision, revisionOf } from "../../../../packages/views/office/docx/test-fixtures/docx-core-revision";

// CORE-REPEAT-001 (T08): two changed Saves in one session must count
// cp:revision 8 -> 9 -> 10, not 8 -> 9 -> 9.

// jsdom ships no CSS.escape; the renderer keys document style rules with it.
if (!globalThis.CSS?.escape) vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^\w-]/g, (character) => `\\${character}`) });

const identity: OfficeIdentity = { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v1", baseRevision: "1" };
const session = { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 } as const;

function memoryDraftStore(): IndexedDbDraftStore {
  return {
    checkpointEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
    rebaseEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
    clearMemory: vi.fn(), list: vi.fn(async () => []),
    recoverEncrypted: vi.fn(async () => ({ status: "missing" as const })),
    deleteDurable: vi.fn(async () => undefined),
  } as unknown as IndexedDbDraftStore;
}
function memoryKeyProvider(): DraftKeyProvider {
  return {
    encrypt: vi.fn(async ({ plaintext }: { plaintext: Uint8Array }) => ({ ciphertext: plaintext, wrappedKey: new Uint8Array([1]), checksum: "sha256:1" })),
    recover: vi.fn(), decrypt: vi.fn(), clearMemory: vi.fn(async () => undefined), registerCleanup: vi.fn(() => () => undefined),
  } as unknown as DraftKeyProvider;
}

describe("DOCX save-source rebase through the web editor host (T08)", () => {
  it("counts cp:revision 8 -> 9 -> 10 across two changed Saves in one session", async () => {
    const source = await docxWithRevision(8);
    const editor = createDocxTiptapHandle({ adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }), documentId: "doc", readBytes: async () => source });
    const committed: Uint8Array[] = [];
    let serverRevision = 1;
    // In-memory cloud ports; parsing, editing, serialization, coordination and
    // the host's post-commit rebase are real.
    const transport: OfficeSaveTransport<DocxTiptapSnapshot> = {
      async serialize({ snapshot }) {
        const saved = await editor.serializeSnapshot(snapshot);
        return { data: saved.bytes, checksumSha256: saved.checksum, sizeBytes: saved.bytes.length, format: "docx" };
      },
      async upload({ output }) {
        committed.push((output.data as Uint8Array).slice());
        return { uploadId: `upload-${committed.length}`, checksumSha256: output.checksumSha256, sizeBytes: output.sizeBytes, claimExpiresAt: "2099-01-01T00:00:00Z" };
      },
      async commit({ intent, upload }) {
        serverRevision += 1;
        return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: "doc", versionId: `v${serverRevision}`, revision: String(serverRevision), checksumSha256: upload.checksumSha256, sizeBytes: upload.sizeBytes, engineName: "genoffice", engineVersion: "1", contractVersion: "office-editor-host/1", protocolVersion: "1" };
      },
      reconcile: vi.fn(async () => null),
    };
    const host = createOfficeEditorSession({ identity, session, editor, transport, draftStore: memoryDraftStore(), keyProvider: memoryKeyProvider() });
    try {
      await editor.open();
      editor.commands.setHeading(2);
      host.coordinator.markDirty(editor.getDirtyGeneration());
      await expect(host.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
      editor.commands.setHeading(1);
      host.coordinator.markDirty(editor.getDirtyGeneration());
      await expect(host.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
      expect(committed).toHaveLength(2);
      expect(await revisionOf(committed[0]!)).toBe("9");
      expect(await revisionOf(committed[1]!)).toBe("10");
      // The rebase touches core properties only: the second Save's body is the edit.
      expect((await parseDocx(committed[1]!)).blocks[0]).toMatchObject({ type: "heading", level: 1 });
    } finally {
      await host.dispose();
    }
  });
});
