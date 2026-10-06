/** A refused `desktop:file-*` command answers `{ opened: false, code }` (main
 * cannot throw a code across Electron's invoke). Throw it as an Error that
 * carries the code, so the save status shows `office.save.reason.<code>`
 * instead of office_unknown_error. */
export function throwIfLocalFileFailed(result: { readonly code?: string }): void {
  if (result.code !== undefined) throw Object.assign(new Error(result.code), { code: result.code });
}

/** The `file_*` code a thrown local-file refusal carries (see above), or
 * undefined for any other error. */
export function localFileFailureCode(error: unknown): string | undefined {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.startsWith("file_") ? code : undefined;
}
