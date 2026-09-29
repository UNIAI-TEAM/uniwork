// PPTX adapter — implements the @uniwork/office-contracts OfficeEngineAdapter
// surface for format "pptx" plus the slides host channels
// (host:slides-edit-transform / host:slides-edit-text, ADR 0021).
//
// Session model: one openPptx handle shared by every runTxn and savePptx —
// the model the user edits IS what gets serialized, never a re-render of the
// input. Saves re-open their own output (a save nobody can read back is not
// a save) and call commitSaved so a second save diffs against the new base.
import {
  ENGINE_LIMITS,
  EngineBoundaryError,
  HostCapabilityRefusal,
  sha256Hex,
  slidesEditTransformRequestSchema,
  type CapabilityEntry,
  type EngineErrorCode,
  type OfficeFormat,
  type OpenFailureClass,
  type OpenOutcome,
  type RenderSlide,
} from "@uniwork/office-contracts";
import type {
  OpenedPptxLike,
  PptxEngineFunctions,
  PptxOpsFunctions,
  PptxParagraphLike,
  PptxRenderPort,
} from "./engine";
import { PptxSessionModel, type PptxEdit } from "./model";
import { inventoryPptxAssets, unsupportedPptxWarnings, type PptxAssetInventory } from "./assets";
import { isEncryptedOoxml } from "../docx/adapter";

function isZipPackage(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

export interface PptxAdapterDeps {
  engine: PptxEngineFunctions;
  ops: PptxOpsFunctions;
  /** Render port for the host channels — absent => typed "unbound" refusal,
   * never a fabricated RenderSlide. */
  render?: PptxRenderPort;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  maxInputBytes?: number;
}

interface PptxSession {
  ref: string;
  documentId: string;
  model: PptxSessionModel;
  assets: PptxAssetInventory;
  /** Bytes of the last successful save — the base the next save diffs from. */
  lastSavedChecksum?: string;
}

let sessionCounter = 0;

/** The slides host channels this adapter implements. @public — the host
 * contract's channel vocabulary; dispatchHostChannel routes by membership. */
export const PPTX_HOST_CHANNELS = ["host:slides-edit-transform", "host:slides-edit-text"] as const;
/** @public */
export type PptxHostChannel = (typeof PPTX_HOST_CHANNELS)[number];

export class PptxAdapter {
  private sessions = new Map<string, PptxSession>();
  constructor(private deps: PptxAdapterDeps) {}

  private failed(
    documentId: string,
    failureClass: OpenFailureClass,
    message?: string,
    engineError?: EngineErrorCode,
  ): OpenOutcome {
    return {
      outcome: "failed",
      document_id: documentId,
      format: "pptx",
      failure_class: failureClass,
      ...(message ? { message } : {}),
      ...(engineError ? { engine_error: engineError } : {}),
    };
  }

  private mapOpenError(documentId: string, error: unknown): OpenOutcome {
    if (error instanceof EngineBoundaryError) {
      return this.failed(documentId, "engine_error", error.message, error.code);
    }
    if (error instanceof HostCapabilityRefusal) {
      return this.failed(documentId, "engine_error", error.message, error.engine_error ?? "engine_crashed");
    }
    const message = String((error as Error)?.message ?? error);
    const lower = message.toLowerCase();
    if (/not a valid zip|corrupted zip|end of central directory|eocd|not a zip/.test(lower)) {
      return this.failed(documentId, "corrupted", "package claims ZIP/OOXML but the container is broken");
    }
    if (/not a pptx|missing ppt\/presentation\.xml|presentation\.xml/.test(lower)) {
      return this.failed(documentId, "corrupted", message);
    }
    return this.failed(documentId, "corrupted", message);
  }

  async open(input: {
    bytes: Uint8Array;
    format: OfficeFormat;
    document_id: string;
    locale?: string;
  }): Promise<OpenOutcome> {
    const { bytes, document_id } = input;
    if (input.format !== "pptx") {
      throw new EngineBoundaryError("unsupported_operation", { format: input.format, expected: "pptx" });
    }
    const max = this.deps.maxInputBytes ?? ENGINE_LIMITS.max_input_bytes;
    if (bytes.length > max) {
      return this.failed(document_id, "too_large", "input " + bytes.length + " exceeds the " + max + " byte bound");
    }
    // Encrypted OOXML: upstream has no pptx decrypt path (docx-encryption is
    // docs-only) — the honest class is unsupported_feature, not a blank deck.
    if (isEncryptedOoxml(bytes)) {
      return this.failed(document_id, "unsupported_feature", "encrypted pptx: no decrypt path is bound for this format");
    }
    if (!isZipPackage(bytes)) {
      return this.failed(document_id, "not_office_file", "bytes are not a ZIP/OOXML container");
    }
    let opened: OpenedPptxLike;
    try {
      opened = await this.deps.engine.openPptx(bytes);
    } catch (error) {
      return this.mapOpenError(document_id, error);
    }
    if (!opened?.deck || !Array.isArray(opened.deck.slides)) {
      return this.failed(document_id, "corrupted", "engine returned a deck without a slide list");
    }
    const assets = inventoryPptxAssets(opened);
    const warnings = unsupportedPptxWarnings(assets);
    sessionCounter += 1;
    const ref = "pptx-session-" + sessionCounter;
    this.sessions.set(ref, {
      ref,
      documentId: document_id,
      model: new PptxSessionModel(opened, this.deps.ops),
      assets,
    });
    return { outcome: "opened", document_id, document_model_ref: ref, warnings };
  }

  sessionOf(documentModelRef: string): PptxSession {
    const session = this.sessions.get(documentModelRef);
    if (!session) {
      throw new EngineBoundaryError("not_found", { document_model_ref: documentModelRef });
    }
    return session;
  }

  /** Session-bound edit channel: typed PptxEdit ops on the held deck. */
  edit(
    documentModelRef: string,
    edit: PptxEdit,
  ): { applied: true; revision: number; createdId?: string; targetId?: string } {
    const session = this.sessionOf(documentModelRef);
    const result = session.model.applyEdit(edit);
    return { ...result, applied: true, revision: session.model.revision };
  }

  release(documentModelRef: string): boolean {
    return this.sessions.delete(documentModelRef);
  }

  async serialize(input: {
    document_model_ref: string;
    format: OfficeFormat;
  }): Promise<{ bytes: Uint8Array; checksum: string; warnings?: unknown[] }> {
    const session = this.sessionOf(input.document_model_ref);
    if (input.format !== "pptx") {
      throw new EngineBoundaryError("unsupported_operation", { format: input.format, expected: "pptx" });
    }
    let out: Uint8Array;
    try {
      out = await this.deps.engine.savePptx(session.model.opened);
    } catch (error) {
      if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
      throw new EngineBoundaryError("engine_crashed", { detail: String((error as Error)?.message ?? error) });
    }
    if (!out || out.length === 0) {
      throw new EngineBoundaryError("engine_result_invalid", { detail: "savePptx returned empty bytes" });
    }
    if (out.length > ENGINE_LIMITS.max_output_bytes) {
      throw new EngineBoundaryError("upload_bounds", { detail: "output exceeds byte bound" });
    }
    // Save-verify: re-open the produced bytes; a deck that won't re-open is
    // not a save (the G0 host does the same before staging).
    let reopened: OpenedPptxLike;
    try {
      reopened = await this.deps.engine.openPptx(out);
    } catch (error) {
      if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
      throw new EngineBoundaryError("engine_result_invalid", { detail: "saved deck does not reopen" });
    }
    if (!reopened?.deck?.slides || reopened.deck.slides.length === 0) {
      throw new EngineBoundaryError("engine_result_invalid", { detail: "saved deck reopened with no slides" });
    }
    // commitSaved marks the produced bytes as the new base — a second
    // serialize diffs against this state, not the original input.
    try {
      this.deps.engine.commitSaved?.(session.model.opened);
    } catch (error) {
      if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
      throw new EngineBoundaryError("engine_crashed", { detail: "commitSaved failed on a verified save" });
    }
    session.model.markSaved();
    session.assets = inventoryPptxAssets(session.model.opened);
    const hash = this.deps.sha256 ?? sha256Hex;
    const checksum = await hash(out);
    session.lastSavedChecksum = checksum;
    return { bytes: out, checksum, warnings: [] };
  }

  // ── slides host channels (ADR 0021 QĐ6.3) ────────────────────────────────

  /** host:slides-edit-transform — the renderer-owned drag/resize/rotate
   * gesture. Validates the contract request, applies the setTransform op on
   * the session's deck, then answers the updated RenderSlide. When no render
   * port is bound the channel refuses "unbound" BEFORE mutating — a refused
   * gesture must not leave partial state behind. */
  async handleSlidesEditTransform(documentModelRef: string, body: unknown): Promise<RenderSlide> {
    const session = this.sessionOf(documentModelRef);
    if (!this.deps.render) {
      throw new HostCapabilityRefusal(
        "host:slides-edit-transform",
        "unbound",
        "transform channel needs a bound render port to answer RenderSlide",
      );
    }
    const req = slidesEditTransformRequestSchema.safeParse(body);
    if (!req.success) {
      throw new HostCapabilityRefusal(
        "host:slides-edit-transform",
        "failed",
        "request violates the contract schema: " + req.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; "),
      );
    }
    const { slideIndex, sourceId, xPx, yPx, wPx, hPx, rotationDeg, fitWidthPx, groupId } = req.data;
    if (!sourceId) {
      throw new HostCapabilityRefusal("host:slides-edit-transform", "failed", "transform needs sourceId");
    }
    session.model.editTransform({
      slideIndex,
      elementId: sourceId,
      xPx,
      yPx,
      wPx,
      hPx,
      rotationDeg,
      fitWidthPx: fitWidthPx ?? session.model.fitWidthPx,
      ...(groupId ? { groupId } : {}),
    });
    return this.renderSlide(session, slideIndex, fitWidthPx ?? session.model.fitWidthPx);
  }

  /** Render the post-edit slide for the channel answer. The edit already
   * landed when this runs, so a render failure is a typed engine error —
   * never a raw throw, and never reported as "the gesture didn't apply". */
  private async renderSlide(session: PptxSession, slideIndex: number, fitWidthPx: number): Promise<RenderSlide> {
    try {
      return (await this.deps.render!.buildRenderSlide(session.model.opened, slideIndex, fitWidthPx)) as RenderSlide;
    } catch (error) {
      if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
      throw new EngineBoundaryError("engine_crashed", {
        detail: "render failed after the edit landed; the model already carries the change",
      });
    }
  }

  /** host:slides-edit-text — same channel contract as transform. */
  async handleSlidesEditText(
    documentModelRef: string,
    body: { slideIndex: number; sourceId?: string | null; paragraphs: unknown[]; groupId?: string | null },
  ): Promise<RenderSlide> {
    const session = this.sessionOf(documentModelRef);
    if (!this.deps.render) {
      throw new HostCapabilityRefusal(
        "host:slides-edit-text",
        "unbound",
        "text channel needs a bound render port to answer RenderSlide",
      );
    }
    if (!body || typeof body.slideIndex !== "number" || !Array.isArray(body.paragraphs)) {
      throw new HostCapabilityRefusal("host:slides-edit-text", "failed", "request needs slideIndex + paragraphs");
    }
    session.model.editText({
      slideIndex: body.slideIndex,
      elementId: body.sourceId ?? undefined,
      paragraphs: body.paragraphs as PptxParagraphLike[],
      ...(body.groupId ? { groupId: body.groupId } : {}),
    });
    return this.renderSlide(session, body.slideIndex, session.model.fitWidthPx);
  }

  /** One dispatch point for the host adapter: known slides channels route to
   * their handlers, anything else refuses by name — never silence. */
  async dispatchHostChannel(documentModelRef: string, channel: string, body: unknown): Promise<RenderSlide> {
    switch (channel) {
      case "host:slides-edit-transform":
        return this.handleSlidesEditTransform(documentModelRef, body);
      case "host:slides-edit-text":
        return this.handleSlidesEditText(
          documentModelRef,
          body as { slideIndex: number; sourceId?: string | null; paragraphs: unknown[]; groupId?: string | null },
        );
      default:
        throw new HostCapabilityRefusal(channel, "unsupported", "the pptx adapter does not implement " + channel);
    }
  }

  /** Honest capability rows for format pptx (G0 module-runtime-map states):
   * rows proven by the G2-03b vendored-engine replay carry "proven"; the
   * service-side rows keep pending with their proving lane. */
  async capability(format: OfficeFormat): Promise<Record<string, unknown>> {
    if (format !== "pptx") {
      throw new EngineBoundaryError("unsupported_operation", { format, expected: "pptx" });
    }
    const rows: CapabilityEntry[] = [
      {
        operation: "open",
        supported: true,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: pptx-open on vendored pptx-engine (F-PPTX-STD)",
      },
      {
        operation: "edit",
        supported: true,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: text/transform/image/ordering ops on real runTxn, verified by extraction",
      },
      {
        operation: "serialize",
        supported: true,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: savePptx + reopen-verify + commitSaved two-save on vendored engine",
      },
      {
        operation: "slides-edit-transform",
        supported: this.deps.render !== undefined,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: host:slides-edit-transform lands byte-exact EMU xfrm; unbound render => typed refusal",
      },
      {
        operation: "convert",
        supported: false,
        runtime: "internal_service",
        evidence_level: "pending",
        reason: "service-side job (G2-02); no lab channel exists",
      },
      {
        operation: "export",
        supported: false,
        runtime: "internal_service",
        evidence_level: "pending",
        reason: "export path has no working channel; unsupported_operation is the honest answer",
      },
    ];
    return { format: "pptx", channels: [...PPTX_HOST_CHANNELS], rows };
  }

  isDirty(ref: string): boolean {
    return this.sessionOf(ref).model.dirty;
  }
}

export function createPptxAdapter(deps: PptxAdapterDeps): PptxAdapter {
  return new PptxAdapter(deps);
}
