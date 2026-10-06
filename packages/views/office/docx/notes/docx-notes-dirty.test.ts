// B3 fix regression (F1) on the real vendored engine: note-list mutations that
// leave the document untouched — a note-text-only edit, an insert, a delete
// whose markers are already gone — must still move the save generation the
// coordinator sees, or coordinator.save() refuses as `clean` and the edit is
// lost. The notes controller's monotonic revision folds into the same
// onTransaction dirty condition the comments revision uses.
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import type { DraftAdapter, OfficeSaveTransport } from "@uniwork/core/office/host-contract";
import { createDocxTiptapHandle, type DocxTiptapSnapshot } from "../use-docx-tiptap-handle";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const FOOTNOTES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="${W}">` +
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> original note</w:t></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> second note</w:t></w:r></w:p></w:footnote>` +
  `</w:footnotes>`;

/** Include the `w:footnoteReference` marker for note 1 in the body. */
async function fixture(marker = true): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
  );
  zip.file("_rels/.rels", `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="${REL}"><Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rFoot" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
  );
  zip.file("word/footnotes.xml", FOOTNOTES_XML);
  const ref = marker
    ? `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`
    : "";
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      `<w:p><w:r><w:t>before</w:t></w:r>${ref}<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>plain</w:t></w:r></w:p>` +
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
      `</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function openHandle(bytes: Uint8Array) {
  const adapter = createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) });
  const handle = createDocxTiptapHandle({ adapter, documentId: "doc-notes", readBytes: async () => bytes });
  return handle.open().then(() => handle);
}

function memoryDraft(): DraftAdapter<DocxTiptapSnapshot> {
  return {
    checkpoint: vi.fn(async () => undefined),
    recover: vi.fn(async () => null),
    discard: vi.fn(async () => undefined),
    persistIntent: vi.fn(async () => undefined),
    loadIntent: vi.fn(async () => null),
    clearIntent: vi.fn(async () => undefined),
  };
}

function memoryTransport(handle: Awaited<ReturnType<typeof openHandle>>): OfficeSaveTransport<DocxTiptapSnapshot> {
  return {
    async serialize({ snapshot }) {
      const saved = await handle.serializeSnapshot(snapshot);
      return { data: saved.bytes, checksumSha256: saved.checksum, sizeBytes: saved.bytes.length, format: "docx" };
    },
    async upload({ output }) {
      return { uploadId: "upload-1", checksumSha256: output.checksumSha256, sizeBytes: output.sizeBytes, claimExpiresAt: "2099-01-01T00:00:00Z" };
    },
    async commit({ intent, upload }) {
      return {
        intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: "doc-notes",
        versionId: "version-2", revision: "2", checksumSha256: upload.checksumSha256, sizeBytes: upload.sizeBytes,
        engineName: "genoffice", engineVersion: "09485f88", contractVersion: "office-editor-host/1", protocolVersion: "1",
      };
    },
    reconcile: vi.fn(async () => null),
  };
}

function coordinatorFor(handle: Awaited<ReturnType<typeof openHandle>>) {
  const coordinator = createOfficeSaveCoordinator<DocxTiptapSnapshot>({
    identity: { deploymentId: "dep-1", accountId: "acct-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-notes", generation: 1, baseVersionId: "version-1", baseRevision: "1" },
    editor: handle,
    draft: memoryDraft(),
    transport: memoryTransport(handle),
  });
  // The DocxEditor wiring: subscribeDirty -> coordinator.markDirty.
  const unsubscribe = handle.subscribeDirty!((generation) => coordinator.markDirty(generation));
  return { coordinator, unsubscribe };
}

describe("DOCX note dirty generation and save gating", () => {
  it("a note-text-only edit moves the dirty generation and the save is accepted", async () => {
    const handle = await openHandle(await fixture());
    try {
      const { coordinator, unsubscribe } = coordinatorFor(handle);
      expect(coordinator.getState()).toMatchObject({ state: "ready", dirtyGeneration: 0 });
      expect(handle.commands?.setDocxNoteText("footnote", "2", "rewritten")).toBe(true);
      expect(handle.getDirtyGeneration()).toBeGreaterThan(0);
      expect(coordinator.getState().state).toBe("dirty");
      expect(coordinator.getState().dirtyGeneration).toBe(handle.getDirtyGeneration());

      const result = await coordinator.save();
      expect(result, JSON.stringify(coordinator.getState())).toMatchObject({ accepted: true });
      expect(coordinator.getState().lastSavedGeneration).toBe(handle.getDirtyGeneration());
      unsubscribe();
    } finally {
      await handle.dispose();
    }
  });

  it("a delete whose markers are already gone still marks the document dirty", async () => {
    const handle = await openHandle(await fixture(false));
    try {
      const { coordinator, unsubscribe } = coordinatorFor(handle);
      expect(handle.commands?.hasDocxNoteRef("footnote", "1")).toBe(false);
      expect(handle.commands?.deleteDocxNote("footnote", "1")).toBe(true);
      expect(handle.getDirtyGeneration()).toBeGreaterThan(0);
      expect(coordinator.getState().state).toBe("dirty");
      unsubscribe();
    } finally {
      await handle.dispose();
    }
  });

  it("inserting a note moves the dirty generation and the save is accepted", async () => {
    const handle = await openHandle(await fixture());
    try {
      const { coordinator, unsubscribe } = coordinatorFor(handle);
      expect(handle.commands?.insertDocxNote("footnote", "added note")).toMatchObject({ id: "3" });
      expect(handle.getDirtyGeneration()).toBeGreaterThan(0);
      expect(coordinator.getState().state).toBe("dirty");
      expect((await handle.captureSnapshot()).value.notes?.footnotes.map((note) => note.id)).toContain("3");

      const result = await coordinator.save();
      expect(result, JSON.stringify(coordinator.getState())).toMatchObject({ accepted: true });
      unsubscribe();
    } finally {
      await handle.dispose();
    }
  });
});
