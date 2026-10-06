import { isAllocationFailure } from "../../shared/memory";

/** The one place the renderer touches incoming file bytes. Bytes arrive from
 * main as binary (never base64), so the only thing that can still go wrong
 * here is the machine running out of memory while a copy or a string is built.
 * That is the typed `file_insufficient_memory` code, which the save status
 * already maps to `office.save.reason.file_insufficient_memory`. */
const FILE_INSUFFICIENT_MEMORY = "file_insufficient_memory";

function memoryError(): Error {
  return Object.assign(new Error(FILE_INSUFFICIENT_MEMORY), { code: FILE_INSUFFICIENT_MEMORY });
}

/** Run an allocation-heavy step; an allocation failure becomes the typed
 * memory error, any other error propagates unchanged. */
function withMemoryGuard<T>(step: () => T): T {
  try { return step(); }
  catch (error) { throw isAllocationFailure(error) ? memoryError() : error; }
}

/** Normalise a byte field received over the bridge (an ArrayBuffer or a
 * Uint8Array, possibly from another realm) to a Uint8Array view. */
export function incomingBytes(value: unknown): Uint8Array {
  return withMemoryGuard(() => {
    const tag = Object.prototype.toString.call(value);
    if (tag === "[object Uint8Array]") return value as Uint8Array;
    if (tag === "[object ArrayBuffer]") return new Uint8Array(value as ArrayBuffer);
    throw new Error("invalid_bytes");
  });
}

/** Decode UTF-8 bytes (a JSON snapshot) to text. */
export function bytesToText(bytes: Uint8Array): string {
  return withMemoryGuard(() => new TextDecoder().decode(bytes));
}

/** Encode text (a JSON snapshot) to UTF-8 bytes. */
export function textToBytes(text: string): Uint8Array<ArrayBuffer> {
  return withMemoryGuard(() => new TextEncoder().encode(text));
}

/** A private copy of the bytes, for a holder that must not alias the opened file. */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  return withMemoryGuard(() => bytes.slice());
}

/** True for the typed memory error above, or for a raw allocation failure that
 * reached a caller outside the guard. */
export function isMemoryFailure(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === FILE_INSUFFICIENT_MEMORY || isAllocationFailure(error);
}
