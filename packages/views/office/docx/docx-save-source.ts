import JSZip from "jszip";

// CORE-REPEAT-001: the save source is the open bytes, and the engine bumps
// docProps/core.xml (cp:revision, dcterms:modified) from the source on every
// Save. After a commit the source's core part is replaced by the committed
// one, so the next Save counts from the revision the server now holds. The
// document body stays on the open parse the editor's block indexes point at.

const CORE_PROPS = "docProps/core.xml";

/** Receipts may carry the checksum with or without its algorithm prefix. */
export function checksumKey(checksum: string): string {
  return checksum.replace(/^sha256:/, "");
}

export async function readCoreProps(bytes: Uint8Array): Promise<string | null> {
  const part = (await JSZip.loadAsync(bytes)).file(CORE_PROPS);
  return part ? part.async("string") : null;
}

export async function withCoreProps(source: Uint8Array, coreProps: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(source);
  if (!zip.file(CORE_PROPS)) return source;
  zip.file(CORE_PROPS, coreProps);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
