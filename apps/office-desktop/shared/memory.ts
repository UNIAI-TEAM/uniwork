/** Node and V8 report "this machine cannot hold that many bytes" in several
 * ways: a RangeError from an allocation, Node's own 2 GiB `readFile` refusal,
 * a string past the engine limit, or ENOMEM. They all mean the same thing to
 * the user, so main answers one typed `insufficient_memory` for any of them. */
const MEMORY_CODES: ReadonlySet<string> = new Set([
  "ERR_FS_FILE_TOO_LARGE",
  "ERR_STRING_TOO_LONG",
  "ERR_BUFFER_TOO_LARGE",
  "ERR_MEMORY_ALLOCATION_FAILED",
  "ENOMEM",
  "insufficient_memory",
]);

const MEMORY_MESSAGE = /array buffer allocation failed|invalid typed array length|invalid (array( buffer)?|string) length|cannot create a string longer|allocation failed|out of memory|buffer size/i;

export function isAllocationFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && MEMORY_CODES.has(code)) return true;
  return error instanceof RangeError && typeof message === "string" && MEMORY_MESSAGE.test(message);
}
