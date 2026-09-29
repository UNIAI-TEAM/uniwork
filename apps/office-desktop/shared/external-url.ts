/** External navigation is deliberately narrow: only HTTPS and an exact host
 * allowlist are accepted. Keep this policy dependency-free so both the main
 * navigation guards and the IPC validator use the same decision. */
export function isAllowedExternalUrl(value: string, allowedHosts: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.some((host) => url.hostname.toLowerCase() === host.toLowerCase());
  } catch {
    return false;
  }
}
