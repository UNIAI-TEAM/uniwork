import { createPdfEditorLoader, type PdfOpenOutcome } from "@uniwork/views/office/pdf";
import { DocxEditor } from "@uniwork/views/office/docx";
import type { OfficeEditorLoader } from "@uniwork/views/office/editor-slot";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";
import type { DesktopDocumentFormat } from "../../shared/document-formats";
import type { ByteDocumentSession } from "./session";
import type { DesktopDocxSurface } from "./docx-surface";

export interface DesktopEditorLoaderConfig {
  documentKey: string;
  title: string;
  session: ByteDocumentSession;
  capability: OfficeCapabilityEntry;
  /** Bumped by a recovered draft so the lane remounts its editor surface. */
  surfaceVersion: number;
}

/** Format lane loaders, one entry per format. The slot asks for the opened
 * document's format and gets its loader; no caller branches on format. */
const EDITOR_LOADERS: Partial<Record<DesktopDocumentFormat, (config: DesktopEditorLoaderConfig) => OfficeEditorLoader<Uint8Array>>> = {
  docx: ({ documentKey, title, session, capability, surfaceVersion }) => async () => ({ default: function DesktopDocx() {
    const editor = session.editor as DesktopDocxSurface;
    return <DocxEditor key={surfaceVersion} documentKey={documentKey} title={title} editor={editor} coordinator={session.coordinator} capability={capability as never} manageSession={false} showDocumentControls={false} open={{ open: async () => (await session.openEditor() as DesktopDocxSurface).openOutcome()! }} />;
  } }),
  pdf: ({ documentKey, title, session, capability }) => (async (format) => await createPdfEditorLoader({
    documentKey,
    title,
    coordinator: session.coordinator as never,
    capability: capability as never,
    open: { open: async (signal?: AbortSignal, password?: string): Promise<PdfOpenOutcome> => {
      const surface = await session.openEditor();
      if (password !== undefined) await (surface.open as (signal?: AbortSignal, password?: string) => Promise<void>)(signal, password);
      const outcome = surface.openOutcome?.();
      if (outcome?.outcome === "opened") return outcome as PdfOpenOutcome;
      if (outcome?.outcome === "failed") return outcome as PdfOpenOutcome;
      return { outcome: "failed", document_id: documentKey, format: "pdf", failure_class: "engine_error" };
    } },
  })(format)) as OfficeEditorLoader<Uint8Array>,
};

export function desktopEditorLoader(format: DesktopDocumentFormat, config: DesktopEditorLoaderConfig): OfficeEditorLoader<Uint8Array> | undefined {
  return EDITOR_LOADERS[format]?.(config);
}
