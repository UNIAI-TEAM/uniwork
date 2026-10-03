import type { DesktopDocumentFormat } from "../../shared/document-formats";
import type { DesktopSurfaceFactory } from "./surface";

/** Format lane registry: the byte session asks for the surface of the opened
 * document's format and gets a typed refusal when no lane is mounted yet.
 * Adding a format means adding its entry here; no caller branches on format. */
const SURFACE_FACTORIES: Partial<Record<DesktopDocumentFormat, DesktopSurfaceFactory>> = {
  docx: async (settings) => (await import("./docx-surface")).createDesktopDocxSurface(settings),
  pdf: async (settings) => (await import("./pdf-surface")).createDesktopPdfSurface(settings),
};

export function desktopSurfaceFactory(format: DesktopDocumentFormat): DesktopSurfaceFactory | undefined {
  return SURFACE_FACTORIES[format];
}
