/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest";
import { createByteDocumentSession } from "./session";
import { bytesChecksum, docxIdentity, installDocxGeometry } from "../../test/docx-fixture";
import { docxWithRevision, revisionOf } from "../../../../packages/views/office/docx/test-fixtures/docx-core-revision";

// CORE-REPEAT-001 (T08): two changed Saves in one desktop session must count
// cp:revision 8 -> 9 -> 10, not 8 -> 9 -> 9.

installDocxGeometry();
if (!globalThis.CSS?.escape) vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^\w-]/g, (character) => `\${character}`) });

it("counts cp:revision 8 -> 9 -> 10 across two changed cloud Saves in one session", async () => {
  const source = await docxWithRevision(8);
  const saved: Uint8Array[] = [];
  let revision = 1;
  let lastChecksum = "";
  const call = vi.fn(async (channel: string, payload: { data: Uint8Array; documentId: string; intentId: string; idempotencyKey: string; checksum: string }) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:draft-discard") return { discarded: true };
    if (channel === "desktop:office-save") {
      saved.push(Uint8Array.from(Buffer.from(payload.data)));
      revision += 1;
      lastChecksum = payload.checksum;
      return { documentId: payload.documentId, intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, checksum: payload.checksum, versionId: `v${revision}`, revision: String(revision) };
    }
    if (channel === "desktop:office-open") return { data: Uint8Array.from(Buffer.from("", "base64")), checksum: lastChecksum, document: { id: "doc", workspaceId: "ws", title: "Spec.docx", kind: "file", format: "docx", version: revision, revision: String(revision), updatedAt: new Date(0).toISOString(), ownerKind: null, canEdit: true, downloadAvailable: true }, filename: "Spec.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    throw new Error(`unexpected ${channel}`);
  });
  const session = createByteDocumentSession({ call: call as never }, docxIdentity, { format: "docx", data: Uint8Array.from(Buffer.from(source)), checksum: bytesChecksum(source) });
  try {
    await session.openEditor();
    session.editor.commands?.setHeading(2);
    await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
    session.editor.commands?.setHeading(1);
    await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
    expect(saved).toHaveLength(2);
    expect(await revisionOf(saved[0]!)).toBe("9");
    expect(await revisionOf(saved[1]!)).toBe("10");
  } finally {
    session.dispose();
  }
});
