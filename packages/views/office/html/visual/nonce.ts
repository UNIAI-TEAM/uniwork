/**
 * The per-session inspector nonce (ADR 0027): 32 lowercase hex characters from
 * the platform CSPRNG. The preview port validates the same shape
 * (`apps/web/platform/office/preview-inspector.ts` - views must not import it)
 * and refuses the mount for anything else. A platform with no randomness throws
 * so the caller falls back to the script-free preview instead of rendering a
 * frame with a predictable nonce.
 */
export function createVisualEditNonce(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("visual-edit nonce source is unavailable");
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
