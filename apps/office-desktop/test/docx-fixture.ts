import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

export const docxSource = Uint8Array.from(readFileSync(resolve("../../docs/office/g0/fixtures/files/docs/docx-simple.docx")));
export const bytesChecksum = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const docxIdentity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "1", baseVersionId: "v1" };

/** Fixture-only ZIP reader compares uncompressed OOXML parts, independent of
 * the editor's parser and writer. Fixture packages use stored/deflate entries. */
export function zipParts(bytes: Uint8Array): Map<string, Buffer> {
  const zip = Buffer.from(bytes);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP end record missing");
  const count = zip.readUInt16LE(end + 10);
  let position = zip.readUInt32LE(end + 16);
  const parts = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(position) !== 0x02014b50) throw new Error("ZIP directory invalid");
    const method = zip.readUInt16LE(position + 10);
    const compressed = zip.readUInt32LE(position + 20);
    const nameLength = zip.readUInt16LE(position + 28);
    const extraLength = zip.readUInt16LE(position + 30);
    const commentLength = zip.readUInt16LE(position + 32);
    const local = zip.readUInt32LE(position + 42);
    const name = zip.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + compressed);
    if (method !== 0 && method !== 8) throw new Error("ZIP method unsupported");
    parts.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    position += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

export function installDocxGeometry() {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => ({ length: 0, item: () => null }) });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
}
