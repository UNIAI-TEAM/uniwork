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

/** The renderer's wire code for the same condition (main's failure-code table
 * maps insufficient_memory to it). */
const FILE_INSUFFICIENT_MEMORY = "file_insufficient_memory";

/** Electron's `ipcRenderer.invoke` rejects with a plain Error whose message is
 * "Error invoking remote method '<channel>': " + String(error), so only the
 * thrown error's `Name: message` (or Node's `Name [CODE]: message`) survives. */
const INVOKE_REJECTION = /^Error invoking remote method '[^']*': ([A-Za-z]*Error)(?: \[([A-Z0-9_]+)\])?: ([\s\S]*)$/;

/** True for any out-of-memory failure the renderer can meet: an allocation
 * failure of its own, the typed file_insufficient_memory code, or a main-side
 * one relayed by invoke (the wrapper message carrying a memory code, or a
 * RangeError with an allocation message). Any other error, wrapped or not,
 * stays a generic failure. */
export function isMemoryFailure(error: unknown): boolean {
  if (isAllocationFailure(error)) return true;
  if (error === null || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === FILE_INSUFFICIENT_MEMORY) return true;
  if (typeof message !== "string") return false;
  const relayed = INVOKE_REJECTION.exec(message.trim());
  if (!relayed) return false;
  const [, name, nodeCode, detail] = relayed as unknown as [string, string, string | undefined, string];
  if ((nodeCode !== undefined && MEMORY_CODES.has(nodeCode)) || MEMORY_CODES.has(detail) || detail === FILE_INSUFFICIENT_MEMORY) return true;
  return name === "RangeError" && MEMORY_MESSAGE.test(detail);
}
