import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";

export function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new Error("xlsx_serialized_output_bytes_invalid");
}

export function cloneSnapshot(snapshot: XlsxWorkbookSnapshot): XlsxWorkbookSnapshot {
  return structuredClone(snapshot);
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export async function fingerprint(snapshot: XlsxWorkbookSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(snapshot));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("xlsx_fingerprint_unavailable");
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The renderer digest only seeds its workbook identity. */
export async function digestHex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `bytes-${bytes.byteLength}`;
  const digest = await subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
