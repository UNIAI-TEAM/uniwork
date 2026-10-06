/** Wire codes for a refused local-file command. Electron carries only an
 * Error's message across `invoke`, so a thrown code never reaches the renderer;
 * main answers with one of these in the response instead. They are stable
 * `[a-z0-9_]` identifiers the renderer maps to its own copy — never an OS
 * message, a path or byte content. */
const FILE_FAILURE_CODES: Readonly<Record<string, string>> = {
  invalid_path: "file_invalid_path",
  not_found: "file_not_found",
  symlink_refused: "file_access_denied",
  locked: "file_locked",
  external_modification: "file_changed_on_disk",
  invalid_handle: "file_handle_invalid",
  session_revoked: "file_session_revoked",
  read_failed: "file_read_failed",
  write_failed: "file_write_failed",
  replace_failed: "file_replace_failed",
  insufficient_memory: "file_insufficient_memory",
  // Save-side only: the draft checkpoint that precedes a local Save failed.
  // There is no size code: a local working file has no size cap (UNI-956).
  checkpoint_failed: "file_checkpoint_failed",
  saving: "file_save_in_progress",
  engine_unavailable: "file_engine_unavailable",
};

export function desktopFileFailureCodes(): string[] {
  return Object.values(FILE_FAILURE_CODES);
}

function desktopFileFailureCode(internalCode: string): string {
  return FILE_FAILURE_CODES[internalCode] ?? "file_failed";
}

/** Wrap a command so a refusal it throws (as told by `codeOf`) becomes a typed
 * answer; any other error keeps propagating. */
export function answerRefusal<Q, R, F>(handler: (request: Q) => Promise<R>, codeOf: (error: unknown) => string | undefined, answer: (code: string) => F): (request: Q) => Promise<R | F> {
  return async (request) => {
    try { return await handler(request); }
    catch (error) {
      const code = codeOf(error);
      if (code === undefined) throw error;
      return answer(desktopFileFailureCode(code));
    }
  };
}
