// Browser-facing projections must never leak a path, a storage key or a
// credential. Patterns ported from LEAK_PATTERNS in engine-contract.mjs; the
// Go mirror lives in server/internal/office.

const LEAK_PATTERNS: ReadonlyArray<{ rule: string; re: RegExp }> = [
  { rule: "posix_absolute_path", re: /(^|[\s"'=(:])\/(?:home|Users|var|tmp|etc|opt|mnt|root|srv|workspace|private)\// },
  { rule: "windows_absolute_path", re: /[A-Za-z]:\\+/ },
  // Forward-slash drive paths (C:/work/...) are the same leak spelled the
  // other way. The (?!\/) keeps http(s):// scheme colons out of the match.
  { rule: "windows_forward_path", re: /(^|[\s"'=(:,[>])[A-Za-z]:\/(?!\/)/ },
  { rule: "file_url", re: /file:\/\// },
  { rule: "unc_path", re: /\\\\[A-Za-z0-9._-]+\\/ },
  // //host/share spelled forward; ':' is excluded from the prefix so an
  // https:// URL cannot false-positive here.
  { rule: "unc_forward_path", re: /(^|[\s"'=(,[>])\/\/[A-Za-z0-9._-]+\// },
  {
    rule: "storage_key_field",
    re: /(?:"|')?(?:object_key|input_object_key|storage_key|bucket|minio_key)(?:"|')?\s*:/,
  },
  {
    rule: "credential_field",
    re: /(?:"|')?(?:token|secret|password|credential|authorization|api_key|signed_url|presigned)(?:"|')?\s*:/i,
  },
  { rule: "engine_endpoint", re: /https?:\/\/\S*engine/i },
];

/** Scan a browser-facing projection for anything that must never leave Go.
 * Returns the list of violated rules; an empty list means clean. */
export function scanForLeaks(value: unknown): string[] {
  const text = JSON.stringify(value ?? null);
  const leaked: string[] = [];
  for (const { rule, re } of LEAK_PATTERNS) {
    if (re.test(text)) leaked.push(rule);
  }
  return leaked;
}

/**
 * A message that is safe to serialize on a public error surface: the caller's
 * text when it scans clean, otherwise the fallback. Errors cross to the
 * browser verbatim, so a message that names a host path or key is replaced,
 * not redacted - partial redaction keeps the attacker-supplied suffix.
 */
export function publicMessage(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  return scanForLeaks(message).length ? fallback : message;
}
