// P0-1 (UNI-927) — node:fs / node:stream/promises shim for the pptx closure.
//
// The only importer is `savePptxToFile` (packages/pptx-engine/src/index.ts:693),
// a Node streaming convenience the browser host never calls — the browser save
// path is `savePptx` -> Blob -> Documents upload. The lazy `await import()`
// must still resolve at bundle time, so both specifiers alias here and fail
// loud (instead of silently writing nothing) if a host ever reaches them.

function unavailable(): never {
  throw new Error("pptx browser artifact: file streaming is not available in the browser; use savePptx and the Documents upload path");
}

export function createWriteStream(): never {
  return unavailable();
}

export async function pipeline(): Promise<never> {
  return unavailable();
}
