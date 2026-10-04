// C3 (UNI-924) save-path test: protection edits ride the snapshot into the
// real vendored saveDocx — w:documentProtection / w:writeProtection are
// written into word/settings.xml — and an untouched document stays
// byte-identical. Uses the real parse/save bundle, like the page-setup test.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle } from "../use-docx-tiptap-handle";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const CREDENTIALS = { hash: "aGFzaA==", salt: "c2FsdA==", spinCount: 1000, algorithmSid: 14 };

const RESTRICTION_XML =
  `<w:documentProtection w:edit="readOnly" w:enforcement="1" w:cryptProviderType="rsaAES" w:cryptAlgorithmClass="hash"` +
  ` w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="14" w:cryptSpinCount="1000" w:hash="${CREDENTIALS.hash}" w:salt="${CREDENTIALS.salt}"/>`;

/** Realistic package with a settings part; an existing restriction rides in. */
async function fixture(settingsInner = ""): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>` +
      `</Types>`,
  );
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${r}/styles" Target="styles.xml"/><Relationship Id="rSettings" Type="${r}/settings" Target="settings.xml"/></Relationships>`);
  zip.file("word/styles.xml", `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  zip.file("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${w}">${settingsInner}</w:settings>`);
  zip.file("word/document.xml", `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

function handleFor(source: Uint8Array) {
  return createDocxTiptapHandle({
    adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }),
    documentId: "protect",
    readBytes: async () => source,
  });
}

async function settingsXmlOf(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/settings.xml");
  if (!file) throw new Error("settings.xml missing");
  return file.async("string");
}

type ParsedProtection = { protection?: unknown; writeProtection?: unknown };

describe("docx protection save path", () => {
  it("keeps an untouched document byte-identical and carries no edit", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.getState().docxProtection).toEqual({ protection: null, writeProtection: null, pending: false });
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.protection).toBeUndefined();
      const saved = await handle.serializeSnapshot(snapshot);
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });

  it("writes a restriction with its password verifier and round-trips it", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.setDocxProtection({ edit: "readOnly", enforced: true, ...CREDENTIALS })).toBe(true);
      // a second identical apply is a no-op, never a dirtying edit
      expect(handle.commands.setDocxProtection({ edit: "readOnly", enforced: true, ...CREDENTIALS })).toBe(false);
      const state = handle.commands.getState().docxProtection;
      expect(state?.protection).toEqual({ edit: "readOnly", enforced: true, ...CREDENTIALS });
      expect(state?.pending).toBe(true);
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.protection).toEqual({ protection: { edit: "readOnly", enforced: true, ...CREDENTIALS } });
      const saved = await handle.serializeSnapshot(snapshot);
      const settings = await settingsXmlOf(saved.bytes);
      expect(settings).toContain('<w:documentProtection w:edit="readOnly" w:enforcement="1"');
      expect(settings).toContain(`w:hash="${CREDENTIALS.hash}"`);
      expect(settings).toContain(`w:salt="${CREDENTIALS.salt}"`);
      expect(settings).toContain('w:cryptAlgorithmSid="14"');
      expect(settings).toContain('w:cryptSpinCount="1000"');
      const reparsed = (await parseDocx(saved.bytes)) as ParsedProtection;
      expect(reparsed.protection).toMatchObject({ edit: "readOnly", enforced: true, ...CREDENTIALS });
      // a fresh open surfaces the restriction through the panel's own state
      const fresh = handleFor(saved.bytes);
      try {
        await fresh.open();
        expect(fresh.commands.getState().docxProtection?.protection).toMatchObject({ edit: "readOnly", enforced: true, ...CREDENTIALS });
      } finally {
        await fresh.dispose();
      }
    } finally {
      await handle.dispose();
    }
  });

  it("removes an existing restriction and drops it from settings.xml", async () => {
    const source = await fixture(RESTRICTION_XML);
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.getState().docxProtection?.protection).toMatchObject({ edit: "readOnly", enforced: true });
      expect(handle.commands.setDocxProtection(null)).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const settings = await settingsXmlOf(saved.bytes);
      expect(settings).not.toContain("documentProtection");
      const reparsed = (await parseDocx(saved.bytes)) as ParsedProtection;
      expect(reparsed.protection).toBeNull();
    } finally {
      await handle.dispose();
    }
  });

  it("writes a recommended read-only with a password to modify", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.setDocxWriteProtection({ recommended: true, ...CREDENTIALS })).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const settings = await settingsXmlOf(saved.bytes);
      expect(settings).toContain('<w:writeProtection w:recommended="1"');
      expect(settings).toContain(`w:hash="${CREDENTIALS.hash}"`);
      const reparsed = (await parseDocx(saved.bytes)) as ParsedProtection;
      expect(reparsed.writeProtection).toMatchObject({ recommended: true, ...CREDENTIALS });
    } finally {
      await handle.dispose();
    }
  });

  it("drains the pending edit when a draft snapshot is restored", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      const before = await handle.captureSnapshot();
      expect(handle.commands.setDocxProtection({ edit: "comments", enforced: true })).toBe(true);
      handle.restoreSnapshot(before);
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.protection).toBeUndefined();
      expect(handle.commands.getState().docxProtection).toEqual({ protection: null, writeProtection: null, pending: false });
      const saved = await handle.serializeSnapshot(snapshot);
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });
});
