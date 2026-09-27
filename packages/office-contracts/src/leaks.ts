// Browser-facing projections must never leak a path, a storage key or a
// credential. Patterns ported from LEAK_PATTERNS in engine-contract.mjs; the
// Go mirror lives in server/internal/office.

const LEAK_PATTERNS: ReadonlyArray<{ rule: string; re: RegExp }> = [
  { rule: "posix_absolute_path", re: /(^|[\s"'=(:])\/(?:home|Users|var|tmp|etc|opt|mnt)\// },
  { rule: "windows_absolute_path", re: /[A-Za-z]:\\+/ },
  { rule: "file_url", re: /file:\/\// },
  { rule: "unc_path", re: /\\\\[A-Za-z0-9._-]+\\/ },
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
