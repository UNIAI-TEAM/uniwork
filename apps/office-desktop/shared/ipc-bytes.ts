import { z } from "zod";

/** A byte field crosses Electron IPC as a Uint8Array (structured clone), never
 * as base64 text, so a local working file has no wire ceiling of its own: the
 * only limit is the memory of the machine. The check is by tag, not by
 * `instanceof`, because the preload bridge hands the renderer a copy made in
 * another realm. Validation looks at the type only (never at the bytes), and
 * the value is normalised to an exact Uint8Array view so a pooled Buffer never
 * carries unrelated pool memory across the boundary. */
export function isByteValue(value: unknown): value is Uint8Array | ArrayBuffer {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Uint8Array]" || tag === "[object ArrayBuffer]";
}
function exactBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  if (!ArrayBuffer.isView(value)) return new Uint8Array(value);
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) return value;
  return Uint8Array.prototype.slice.call(value) as Uint8Array;
}
export const bytesSchema = z.custom<Uint8Array | ArrayBuffer>(isByteValue, "invalid byte field").transform(exactBytes);
