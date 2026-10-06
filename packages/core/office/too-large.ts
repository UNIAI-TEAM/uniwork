/**
 * UNI-956: the web keeps the shared engine's byte bounds, and every way a web
 * open says "this file is past them" lands on one answer — edit it in
 * UniWork Office desktop, which has no size cap on the working file.
 *
 * Inputs are the shapes the web already holds: an office job error
 * (`code` / `kind` from the server's error table, `upload_bounds` 413
 * `byte_bound` among them), a FileService code (`file_too_large`), or an
 * engine open outcome's `failure_class` (`too_large`).
 */
const TOO_LARGE_CODES: ReadonlySet<string> = new Set(["upload_bounds", "file_too_large", "too_large"]);

export interface OfficeTooLargeSignal {
  code?: string | null;
  kind?: string | null;
  failure_class?: string | null;
  failureClass?: string | null;
}

export function isOfficeTooLarge(signal: OfficeTooLargeSignal | null | undefined): boolean {
  if (!signal) return false;
  if (signal.kind === "byte_bound") return true;
  return [signal.code, signal.failure_class, signal.failureClass].some((value) => typeof value === "string" && TOO_LARGE_CODES.has(value));
}
