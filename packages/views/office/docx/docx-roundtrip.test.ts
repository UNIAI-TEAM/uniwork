import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import type { DraftAdapter, OfficeSaveTransport } from "@uniwork/core/office/host-contract";
import { createDocxTiptapHandle, type DocxTiptapSnapshot } from "./use-docx-tiptap-handle";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const untouched = ["word/header1.xml", "word/styles.xml", "word/media/pixel.png", "customXml/item1.xml"];

async function fixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`);
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${r}/styles" Target="styles.xml"/><Relationship Id="rHeader" Type="${r}/header" Target="header1.xml"/><Relationship Id="rImage" Type="${r}/image" Target="media/pixel.png"/><Relationship Id="rCustom" Type="${r}/customXml" Target="../customXml/item1.xml"/></Relationships>`);
  zip.file("word/styles.xml", `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`);
  zip.file("word/header1.xml", `<w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Untouched header</w:t></w:r></w:p></w:hdr>`);
  zip.file("customXml/item1.xml", '<sentinel xmlns="urn:roundtrip">preserve exactly</sentinel>');
  zip.file("word/media/pixel.png", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", { base64: true });
  const drawing = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Pixel"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="Pixel"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  zip.file("word/document.xml", `<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Spec</w:t></w:r></w:p><w:p><w:r><w:t>Untouched paragraph</w:t></w:r></w:p>${drawing}<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

describe("DOCX OOXML round trip", () => {
  it.each(["button", "shortcut"] as const)("saves through coordinator %s and preserves untouched parts", async (entryPoint) => {
    const source = await fixture();
    const adapter = createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) });
    const handle = createDocxTiptapHandle({ adapter, documentId: "doc-1", readBytes: async () => source });
    const draft: DraftAdapter<DocxTiptapSnapshot> = {
      checkpoint: vi.fn(async () => undefined), recover: vi.fn(async () => null), discard: vi.fn(async () => undefined),
      persistIntent: vi.fn(async () => undefined), loadIntent: vi.fn(async () => null), clearIntent: vi.fn(async () => undefined),
    };
    let uploaded: Uint8Array | undefined;
    const stages: string[] = [];
    // In-memory cloud ports; parsing, editing, serialization and coordination are real.
    const transport: OfficeSaveTransport<DocxTiptapSnapshot> = {
      async serialize({ snapshot }) {
        stages.push("serialize");
        const saved = await handle.serializeSnapshot(snapshot);
        return { data: saved.bytes, checksumSha256: saved.checksum, sizeBytes: saved.bytes.length, format: "docx" };
      },
      async upload({ output }) {
        stages.push("upload");
        expect(output.data).toBeInstanceOf(Uint8Array);
        uploaded = (output.data as Uint8Array).slice();
        return { uploadId: "upload-1", checksumSha256: output.checksumSha256, sizeBytes: output.sizeBytes, claimExpiresAt: "2099-01-01T00:00:00Z" };
      },
      async commit({ intent, upload }) {
        stages.push("commit");
        return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: "doc-1", versionId: "version-2", revision: "2", checksumSha256: upload.checksumSha256, sizeBytes: upload.sizeBytes, engineName: "genoffice", engineVersion: "09485f88", contractVersion: "office-editor-host/1", protocolVersion: "1" };
      },
      reconcile: vi.fn(async () => null),
    };
    try {
      await handle.open();
      expect(handle.commands?.getState().headingLevel).toBe(1);
      const coordinator = createOfficeSaveCoordinator({
        identity: { deploymentId: "dep-1", accountId: "acct-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", generation: 1, baseVersionId: "version-1", baseRevision: "1" },
        editor: handle, draft, transport,
      });
      handle.commands?.setHeading(2);
      coordinator.markDirty(handle.getDirtyGeneration());
      const result = await coordinator.save(entryPoint);
      expect(result, JSON.stringify(coordinator.getState())).toMatchObject({ accepted: true, receipt: { revision: "2" } });
      expect(stages).toEqual(["serialize", "upload", "commit"]);
      expect(coordinator.getState().lastSavedGeneration).toBe(handle.getDirtyGeneration());
      expect(uploaded).toBeDefined();
      const reopened = await parseDocx(uploaded!);
      expect(reopened.blocks[0]).toMatchObject({ type: "heading", level: 2, runs: [expect.objectContaining({ text: "Spec" })] });
      expect(reopened.blocks[1]?.runs?.map((run) => run.text).join("")).toBe("Untouched paragraph");
      const before = await JSZip.loadAsync(source);
      const after = await JSZip.loadAsync(uploaded!);
      for (const part of untouched) {
        expect(after.file(part), part).not.toBeNull();
        expect(await after.file(part)!.async("uint8array"), part).toEqual(await before.file(part)!.async("uint8array"));
      }
      expect(draft.clearIntent).toHaveBeenCalledTimes(1);
    } finally {
      await handle.dispose();
    }
  });
});
