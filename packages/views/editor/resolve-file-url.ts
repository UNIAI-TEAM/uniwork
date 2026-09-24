import { runtimeConfig } from "@uniwork/core/runtime-config";

/** Absolutize site-relative attachment/file URLs for desktop / cross-origin. */
export function resolvePublicFileUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  if (!rawUrl.startsWith("/")) return rawUrl;
  const base = runtimeConfig().appUrl.replace(/\/+$/, "");
  return `${base}${rawUrl}`;
}

export function resolvePublicFileUrlWithBase(
  rawUrl: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!rawUrl) return null;
  if (!rawUrl.startsWith("/")) return rawUrl;
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${rawUrl}`;
}
