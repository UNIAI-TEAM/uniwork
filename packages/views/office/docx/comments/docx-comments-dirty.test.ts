// B2 fix regression (F1/F2/F3) on the real vendored engine:
// - F1: comment-list mutations that leave the document untouched (resolve,
//   reopen, a delete with no live anchors) must still move the save generation
//   the coordinator sees, or the save refuses as `clean`.
// - F3: only a list that differs from the base parse may reach SaveOptions, so
//   an unchanged comments part stays byte-identical and a comment-free document
//   never gains an empty word/comments.xml.
// - F2: a parsed author-less/empty-text entry must survive a mutation + save
//   (the engine oracle is structural for set_comments).
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
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";

interface FixtureOptions {
  /** Include word/comments.xml (+ content type + relationship). */
  comments?: boolean;
  /** Anchor comment 1 in the body (commentRangeStart/End + reference). */
  markers?: boolean;
  /** Author-less, empty-text entry (the shape non-Word producers emit). */
  bare?: boolean;
}

async function fixture(options: FixtureOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  const overrides = [
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`,
  ];
  if (options.comments) {
    overrides.push(
      `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`,
    );
  }
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`,
  );
  zip.file("_rels/.rels", `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  const rels = [`<Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/>`];
  if (options.comments) rels.push(`<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="${REL}">${rels.join("")}</Relationships>`);
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
  );
  if (options.comments) {
    const meta = options.bare ? "" : ` w:author="Alice" w:date="2026-07-01T10:00:00Z" w:initials="A"`;
    const body = options.bare ? "" : "first pass";
    zip.file(
      "word/comments.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${W}" xmlns:w14="${W14}">` +
        `<w:comment w:id="1"${meta} w14:paraId="0A1B2C3D"><w:p><w:r><w:t xml:space="preserve">${body}</w:t></w:r></w:p></w:comment>` +
        `</w:comments>`,
    );
  }
  const anchor = options.markers
    ? `<w:commentRangeStart w:id="1"/><w:r><w:t>marked</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>`
    : "";
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      `<w:p><w:r><w:t xml:space="preserve">hello </w:t></w:r>${anchor}</w:p>` +
      `<w:p><w:r><w:t>plain</w:t></w:r></w:p>` +
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
      `</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function openHandle(bytes: Uint8Array) {
  const adapter = createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) });
  const handle = createDocxTiptapHandle({ adapter, documentId: "doc-comments", readBytes: async () => bytes });
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
        intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: "doc-comments",
        versionId: "version-2", revision: "2", checksumSha256: upload.checksumSha256, sizeBytes: upload.sizeBytes,
        engineName: "genoffice", engineVersion: "09485f88", contractVersion: "office-editor-host/1", protocolVersion: "1",
      };
    },
    reconcile: vi.fn(async () => null),
  };
}

function coordinatorFor(handle: Awaited<ReturnType<typeof openHandle>>) {
  const coordinator = createOfficeSaveCoordinator<DocxTiptapSnapshot>({
    identity: { deploymentId: "dep-1", accountId: "acct-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-comments", generation: 1, baseVersionId: "version-1", baseRevision: "1" },
    editor: handle,
    draft: memoryDraft(),
    transport: memoryTransport(handle),
  });
  // The DocxEditor wiring: subscribeDirty -> coordinator.markDirty.
  const unsubscribe = handle.subscribeDirty!((generation) => coordinator.markDirty(generation));
  return { coordinator, unsubscribe };
}

const partOf = async (bytes: Uint8Array, path: string): Promise<string> => {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file(path);
  return file ? file.async("string") : "";
};

describe("DOCX comment dirty generation and save gating", () => {
  it("resolve moves the dirty generation the coordinator sees and the save is accepted", async () => {
    const handle = await openHandle(await fixture({ comments: true, markers: true }));
    try {
      const { coordinator, unsubscribe } = coordinatorFor(handle);
      expect(coordinator.getState()).toMatchObject({ state: "ready", dirtyGeneration: 0 });
      expect(handle.commands?.resolveDocxComment("1", true)).toBe(true);
      expect(handle.getDirtyGeneration()).toBeGreaterThan(0);
      expect(coordinator.getState().state).toBe("dirty");
      expect(coordinator.getState().dirtyGeneration).toBe(handle.getDirtyGeneration());

      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.comments).toMatchObject([{ id: "1", done: true }]);
      const result = await coordinator.save();
      expect(result, JSON.stringify(coordinator.getState())).toMatchObject({ accepted: true });
      expect(coordinator.getState().lastSavedGeneration).toBe(handle.getDirtyGeneration());
      unsubscribe();
    } finally {
      await handle.dispose();
    }
  });

  it("reopen and reply also move the generation; a reply into a resolved thread inherits done", async () => {
    const handle = await openHandle(await fixture({ comments: true, markers: true }));
    try {
      const { coordinator, unsubscribe } = coordinatorFor(handle);
      expect(handle.commands?.resolveDocxComment("1", true)).toBe(true);
      const afterResolve = handle.getDirtyGeneration();
      expect(handle.commands?.resolveDocxComment("1", false)).toBe(true);
      expect(handle.getDirtyGeneration()).toBeGreaterThan(afterResolve);

      handle.commands?.resolveDocxComment("1", true);
      const reply = handle.commands?.replyToDocxComment("1", "agreed", "Tester");
      expect(reply).toMatchObject({ id: "2", parentId: "1", done: true });
      expect(handle.getDirtyGeneration()).toBeGreaterThan(afterResolve);
      expect(coordinator.getState().state).toBe("dirty");
      unsubscribe();
    } finally {
      await handle.dispose();
    }
  });

  it("a delete whose anchors are already gone still marks the document dirty", async () => {
    const handle = await openHandle(await fixture({ comments: true, markers: false }));
    try {
      const { coordinator, unsubscribe } = coordinatorFor(handle);
      expect(handle.commands?.deleteDocxComment("1")).toBe(true);
      expect(handle.getDirtyGeneration()).toBeGreaterThan(0);
      expect(coordinator.getState().state).toBe("dirty");
      unsubscribe();
    } finally {
      await handle.dispose();
    }
  });

  it("an unchanged comment list never reaches SaveOptions and keeps the part byte-identical", async () => {
    const source = await fixture({ comments: true, markers: true });
    const handle = await openHandle(source);
    try {
      expect((await handle.captureSnapshot()).value.comments).toBeUndefined();
      handle.commands?.insertSymbol("X");
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const before = await JSZip.loadAsync(source);
      const after = await JSZip.loadAsync(saved.bytes);
      expect(await after.file("word/comments.xml")!.async("uint8array")).toEqual(
        await before.file("word/comments.xml")!.async("uint8array"),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("a comment-free document saves without gaining a comments part", async () => {
    const handle = await openHandle(await fixture({ comments: false }));
    try {
      expect((await handle.captureSnapshot()).value.comments).toBeUndefined();
      handle.commands?.insertSymbol("X");
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const after = await JSZip.loadAsync(saved.bytes);
      expect(after.file("word/comments.xml")).toBeNull();
      expect(await partOf(saved.bytes, "[Content_Types].xml")).not.toContain("/word/comments.xml");
    } finally {
      await handle.dispose();
    }
  });

  it("resolving a parsed author-less, empty-text comment saves instead of throwing", async () => {
    const handle = await openHandle(await fixture({ comments: true, markers: true, bare: true }));
    try {
      expect(handle.commands?.getState().docxComments).toMatchObject([{ id: "1", author: "", text: "" }]);
      expect(handle.commands?.resolveDocxComment("1", true)).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const comments = await partOf(saved.bytes, "word/comments.xml");
      // F3 byte-preservation: the entry's text is unchanged, so the save
      // reuses the original w:comment XML verbatim. It never had an author,
      // and re-emitting it must not invent an empty w:author attribute.
      expect(comments).toContain('w:id="1"');
      expect(comments).not.toContain("w:author=");
      // the resolved flag lands in the regenerated commentsExtended part
      expect(await partOf(saved.bytes, "word/commentsExtended.xml")).toContain('w15:done="1"');
    } finally {
      await handle.dispose();
    }
  });
});
