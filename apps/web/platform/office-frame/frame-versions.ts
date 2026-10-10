import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";

/**
 * The installed and verified frame build of a genoffice web module, inlined by
 * next.config.mjs from the module pins: "" when the module has no bundle here,
 * in which case its frame is never offered and the G3 host opens the document.
 * Docs keeps its own variable (UNI-1013); every module, docs included, is also
 * in the one JSON map.
 */
export function pinnedFrameVersion(module: OfficeModule): string {
  if (module === "docs" && process.env.NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION) return process.env.NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION;
  let versions: unknown;
  try {
    versions = JSON.parse(process.env.NEXT_PUBLIC_OFFICE_FRAME_VERSIONS || "{}");
  } catch {
    return "";
  }
  const version = versions && typeof versions === "object" ? (versions as Record<string, unknown>)[module] : undefined;
  return typeof version === "string" ? version : "";
}
