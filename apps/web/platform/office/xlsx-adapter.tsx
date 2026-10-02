"use client";

import { createElement, useEffect, useState, type ReactNode } from "react";
import { downloadDocumentFile, uploadDocumentFile } from "@uniwork/core/api/endpoints/documents";
import { commitDocumentVersion } from "@uniwork/core/api/endpoints/documents-versions";
import type {
  OfficeCapabilityEntry,
  OfficeIdentity,
  OfficeSaveReceipt,
  OfficeSaveTransport,
  OfficeSerializedOutput,
  OfficeUploadReceipt,
  StableSnapshot,
} from "@uniwork/core/office";
import { createOfficeEditorSession, type OfficeEditorSession, type BrowserOfficeDraftOptions } from "./editor-host-core";
import { createXlsxModelHost, XlsxEditor, type XlsxModelHost } from "@uniwork/views/office/xlsx";
import type {
  XlsxEditorHandle,
  XlsxOpenOutcome,
  XlsxRecalcController,
  XlsxSaveCoordinator,
} from "@uniwork/views/office/xlsx";
import type {
  XlsxRecalcResult,
  XlsxRenderModel,
  XlsxWorkbookSnapshot,
} from "@uniwork/office-engine/xlsx";

/**
 * The web host owns this runtime. It may be backed by a worker/IPC bridge, but
 * it must never resolve the Node sidecar or call the engine service directly.
 * Native recalculation is deliberately a separate method so a browser runtime
 * cannot accidentally implement it with a JavaScript formula evaluator.
 */
export interface XlsxSessionRuntime {
  open(input: { bytes: Uint8Array; documentId: string }): Promise<XlsxRuntimeOpenResult>;
  edit(documentModelRef: string, operations: readonly unknown[]): Promise<void>;
  snapshot(documentModelRef: string): XlsxWorkbookSnapshot;
  /** Replace the live model with a protected draft after the host presents a
   * recovery choice. A runtime that cannot restore must omit this method so
   * the host leaves the recovery action disabled rather than claiming success. */
  restore?(documentModelRef: string, snapshot: XlsxWorkbookSnapshot): Promise<void> | void;
  serialize(documentModelRef: string): Promise<XlsxRuntimeSerializedOutput>;
  recalculate?(
    documentModelRef: string,
    signal: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<XlsxRecalcResult>;
  cancelRecalculate?(documentModelRef: string): Promise<void> | void;
  /** Advance the server base after the coordinator commits a version. */
  setBaseRevision?(revision: string): void;
  release(documentModelRef: string): Promise<void> | void;
}

export interface XlsxRuntimeOpenResult {
  outcome: "opened" | "failed";
  document_id: string;
  document_model_ref?: string;
  snapshot?: XlsxWorkbookSnapshot;
  /** G3-05c: the render model the vendored sheets renderer mounts. */
  renderModel?: XlsxRenderModel;
  warnings?: readonly string[];
  failure_class?: string;
  message?: string;
  engine_error?: string;
}

export interface XlsxRuntimeSerializedOutput {
  bytes: Uint8Array;
  checksum: string;
  warnings?: readonly unknown[];
}

/** Documents mutations needed by the XLSX transport. These functions are
 * injected so the adapter stays independent from React Query and is easy to
 * exercise against contract fakes. */
export interface XlsxDocumentsTransport {
  read(): Promise<Uint8Array>;
  upload(input: { file: Blob; idempotencyKey: string }): Promise<{
    upload_id: string;
    checksum_sha256: string;
    size_bytes: number;
    claim_expires_at: string;
  }>;
  commit(input: {
    upload_id: string;
    base_revision: string;
    idempotencyKey: string;
  }): Promise<{
    document: { id: string; revision: string };
    version: {
      id: string;
      checksum_sha256?: string | null;
      size_bytes?: number;
      engine_name?: string | null;
      engine_version?: string | null;
      contract_version?: string | null;
      protocol_version?: string | null;
    };
  }>;
  reconcile?(input: { intentId: string; idempotencyKey: string; documentId: string }): Promise<unknown>;
}

/** Bind the adapter to the existing Documents HTTP endpoints. No endpoint
 * here is a second save path: the coordinator still sequences this transport
 * as serialize -> upload -> commit under one idempotency key. */
export function createXlsxDocumentsTransport(options: { documentId: string; version?: number }): XlsxDocumentsTransport {
  return {
    async read() {
      const blob = await downloadDocumentFile(options.documentId, options.version);
      return new Uint8Array(await blob.arrayBuffer());
    },
    async upload({ file, idempotencyKey }) {
      const receipt = await uploadDocumentFile(options.documentId, file, { idempotencyKey });
      if (!receipt) throw new Error("document_upload_not_verifiable");
      return receipt;
    },
    async commit({ upload_id, base_revision, idempotencyKey }) {
      const receipt = await commitDocumentVersion(
        options.documentId,
        { upload_id, base_revision },
        { idempotencyKey },
      );
      if (!receipt) throw new Error("document_commit_not_verifiable");
      return {
        document: { id: receipt.document.id, revision: receipt.document.revision },
        version: {
          id: receipt.version.id,
          checksum_sha256: receipt.version.checksum_sha256,
          size_bytes: receipt.version.size_bytes,
          engine_name: receipt.version.engine_name,
          engine_version: receipt.version.engine_version,
          contract_version: receipt.version.contract_version,
          protocol_version: receipt.version.protocol_version,
        },
      };
    },
  };
}

export interface XlsxSaveTransportOptions {
  documents: XlsxDocumentsTransport;
  documentId: string;
  serialize?(input: { intentId: string; snapshot: StableSnapshot<XlsxWorkbookSnapshot> }): Promise<XlsxRuntimeSerializedOutput>;
  engineName?: string;
  engineVersion?: string;
  contractVersion?: string;
  protocolVersion?: string;
  runtime?: XlsxSessionRuntime;
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new Error("xlsx_serialized_output_bytes_invalid");
}

function toBlob(bytes: Uint8Array): Blob {
  // Blob accepts the underlying ArrayBuffer only when it is a genuine
  // ArrayBuffer; copy the view to avoid retaining a larger pooled buffer.
  return new Blob([bytes.slice().buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function toUploadReceipt(raw: Awaited<ReturnType<XlsxDocumentsTransport["upload"]>>): OfficeUploadReceipt {
  if (!raw.upload_id || !raw.checksum_sha256 || !raw.claim_expires_at || !Number.isSafeInteger(raw.size_bytes) || raw.size_bytes < 0) {
    throw new Error("malformed_upload_receipt");
  }
  return {
    uploadId: raw.upload_id,
    checksumSha256: raw.checksum_sha256,
    sizeBytes: raw.size_bytes,
    claimExpiresAt: raw.claim_expires_at,
  };
}

/**
 * Real manual-save transport. The only cloud write path is upload followed by
 * commit; checkpoint calls never enter this object. A candidate is copied into
 * a Blob and all receipt fields are checked before being handed to the shared
 * coordinator.
 */
export function createXlsxSaveTransport(options: XlsxSaveTransportOptions): OfficeSaveTransport<XlsxWorkbookSnapshot> {
  const engineName = options.engineName ?? "genoffice";
  const engineVersion = options.engineVersion ?? "unknown";
  const contractVersion = options.contractVersion ?? "unknown";
  const protocolVersion = options.protocolVersion ?? "unknown";
  const outputs = new Map<string, OfficeSerializedOutput>();

  return {
    async serialize({ intent, snapshot }) {
      if (!options.serialize) throw new Error(`xlsx_runtime_not_bound:${intent.intentId}`);
      const out = await options.serialize({ intentId: intent.intentId, snapshot });
      const bytes = bytesOf(out.bytes);
      if (bytes.byteLength === 0 || !out.checksum) throw new Error("malformed_serialized_output");
      return { data: bytes, checksumSha256: out.checksum, sizeBytes: bytes.byteLength, format: "xlsx", ...(out.warnings ? { warnings: out.warnings } : {}) };
    },
    async upload({ intent, output }) {
      if (output.format !== "xlsx") throw new Error("serialized_format_mismatch");
      const data = bytesOf(output.data);
      if (data.byteLength !== output.sizeBytes) throw new Error("serialized_size_mismatch");
      const receipt = toUploadReceipt(await options.documents.upload({ file: toBlob(data), idempotencyKey: intent.idempotencyKey }));
      if (receipt.sizeBytes !== data.byteLength || receipt.checksumSha256 !== output.checksumSha256) {
        throw new Error("upload_checksum_mismatch");
      }
      outputs.set(intent.intentId, output);
      return receipt;
    },
    async commit({ intent, upload }) {
      const result = await options.documents.commit({
        upload_id: upload.uploadId,
        base_revision: intent.identity.baseRevision,
        idempotencyKey: intent.idempotencyKey,
      });
      const version = result.version;
      if (!version?.id || !result.document?.id || !result.document.revision || result.document.id !== options.documentId) {
        throw new Error("malformed_commit_receipt");
      }
      const output = outputs.get(intent.intentId);
      if (!output) throw new Error("serialized_output_missing");
      const checksum = version.checksum_sha256 ?? output.checksumSha256;
      const sizeBytes = version.size_bytes ?? output.sizeBytes;
      if (checksum !== output.checksumSha256 || sizeBytes !== output.sizeBytes) throw new Error("commit_checksum_mismatch");
      outputs.delete(intent.intentId);
      options.runtime?.setBaseRevision?.(result.document.revision);
      return {
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        documentId: result.document.id,
        versionId: version.id,
        revision: result.document.revision,
        checksumSha256: checksum,
        sizeBytes,
        engineName: version.engine_name ?? engineName,
        engineVersion: version.engine_version ?? engineVersion,
        contractVersion: version.contract_version ?? contractVersion,
        protocolVersion: version.protocol_version ?? protocolVersion,
      } satisfies OfficeSaveReceipt;
    },
    async reconcile({ intent }) {
      return options.documents.reconcile?.({ intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: options.documentId }) ?? null;
    },
    async cancel({ intent }) {
      outputs.delete(intent.intentId);
    },
  };
}

function cloneSnapshot(snapshot: XlsxWorkbookSnapshot): XlsxWorkbookSnapshot {
  return {
    revision: snapshot.revision,
    sheets: snapshot.sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      cells: Object.fromEntries(Object.entries(sheet.cells).map(([address, cell]) => [address, { ...cell }])),
    })),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

interface XlsxRuntimeOpenError extends Error {
  failureClass?: string;
  engineError?: string;
}

function runtimeOpenError(outcome: XlsxRuntimeOpenResult): XlsxRuntimeOpenError {
  const error = new Error(outcome.message ?? outcome.failure_class ?? outcome.engine_error ?? "xlsx_open_failed") as XlsxRuntimeOpenError;
  error.failureClass = outcome.failure_class;
  error.engineError = outcome.engine_error;
  return error;
}

async function fingerprint(snapshot: XlsxWorkbookSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(snapshot));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("xlsx_fingerprint_unavailable");
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Content digest for the renderer's workbook identity (it only seeds the
 *  Univer unit id); a host without WebCrypto falls back to a byte count. */
async function digestHex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `bytes-${bytes.byteLength}`;
  const digest = await subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The renderer host is only known after the async open; the view wrapper
 *  below re-renders the editor when it lands (and drops it on dispose). */
interface RenderModelRef {
  current: XlsxModelHost | null;
  listeners: Set<(host: XlsxModelHost | null) => void>;
}

interface XlsxEditorViewProps extends Omit<Parameters<typeof XlsxEditor>[0], "rendererHost"> {
  modelRef: RenderModelRef;
}

function XlsxEditorView({ modelRef, ...editorProps }: XlsxEditorViewProps) {
  const [host, setHost] = useState<XlsxModelHost | null>(modelRef.current);
  useEffect(() => {
    modelRef.listeners.add(setHost);
    setHost(modelRef.current);
    return () => {
      modelRef.listeners.delete(setHost);
    };
  }, [modelRef]);
  return createElement(XlsxEditor, { ...editorProps, ...(host ? { rendererHost: host } : {}) } as never);
}

export interface XlsxFormatAdapterOptions extends BrowserOfficeDraftOptions<XlsxWorkbookSnapshot> {
  identity: OfficeIdentity;
  runtime: XlsxSessionRuntime;
  documents: XlsxDocumentsTransport;
  capability: OfficeCapabilityEntry;
  readonly?: boolean;
  title?: string;
  editorClassName?: string;
}

export interface XlsxFormatAdapter {
  session: OfficeEditorSession<XlsxWorkbookSnapshot>;
  editor: XlsxEditorHandle<XlsxWorkbookSnapshot>;
  capability: OfficeCapabilityEntry;
  editorView: ReactNode;
  open: { open(signal?: AbortSignal): Promise<XlsxOpenOutcome> };
  onRecoverSnapshot?: (snapshot: StableSnapshot<XlsxWorkbookSnapshot>) => Promise<void>;
}

/**
 * Bind G2's XLSX runtime to the G3-03b host seam. The returned editor owns no
 * byte write API: Save is exclusively the shared coordinator's serialize ?
 * upload ? commit pipeline, while recalc is delegated to the injected native
 * service port.
 */
export function createXlsxFormatAdapter(options: XlsxFormatAdapterOptions): XlsxFormatAdapter {
  let modelRef: string | null = null;
  let openedBytes: Uint8Array | null = null;
  let generation = 0;
  let disposed = false;
  let currentSnapshot: XlsxWorkbookSnapshot | null = null;
  let serialized: XlsxRuntimeSerializedOutput | null = null;
  const renderModelRef: RenderModelRef = { current: null, listeners: new Set() };
  const publishRenderModel = (host: XlsxModelHost | null) => {
    renderModelRef.current = host;
    for (const listener of renderModelRef.listeners) listener(host);
  };
  const snapshotListeners = new Set<(snapshot: XlsxWorkbookSnapshot) => void>();
  const publishSnapshot = () => {
    if (!currentSnapshot) return;
    const value = cloneSnapshot(currentSnapshot);
    for (const listener of snapshotListeners) listener(value);
  };

  const editor: XlsxEditorHandle<XlsxWorkbookSnapshot> = {
    format: "xlsx",
    async open() {
      if (disposed) throw new Error("xlsx_editor_disposed");
      if (modelRef) return;
      const bytes = openedBytes ?? await options.documents.read();
      if (disposed) throw new Error("xlsx_editor_disposed");
      openedBytes = bytes;
      const outcome = await options.runtime.open({ bytes, documentId: options.identity.documentId });
      if (disposed) {
        if (outcome.document_model_ref) await options.runtime.release(outcome.document_model_ref);
        throw new Error("xlsx_editor_disposed");
      }
      if (outcome.outcome !== "opened") throw runtimeOpenError(outcome);
      if (!outcome.document_model_ref) throw new Error("xlsx_open_missing_model_ref");
      modelRef = outcome.document_model_ref;
      // G3-05c: when the runtime carries the render model, the editor mounts
      // the vendored grid for this document; otherwise it keeps the table.
      publishRenderModel(
        outcome.renderModel
          ? createXlsxModelHost(outcome.renderModel, {
              sessionId: modelRef,
              name: options.title ?? options.identity.documentId,
              sha256: await digestHex(bytes),
              fileBytes: bytes.byteLength,
            })
          : null,
      );
      currentSnapshot = cloneSnapshot(outcome.snapshot ?? options.runtime.snapshot(modelRef));
      // Opening a workbook establishes the clean baseline.  The identity
      // generation is the draft/auth session generation, not a content edit
      // generation; using it here made the host's checkpoint timer treat an
      // untouched open as dirty and persist a spurious recovery draft.
      generation = 0;
      publishSnapshot();
    },
    getDirtyGeneration: () => generation,
    async captureSnapshot() {
      if (!currentSnapshot) throw new Error("xlsx_snapshot_unavailable");
      const value = cloneSnapshot(currentSnapshot);
      return { generation, fingerprint: await fingerprint(value), value, ...(serialized ? { checksumSha256: serialized.checksum, sizeBytes: serialized.bytes.byteLength } : {}) };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (modelRef) await options.runtime.release(modelRef);
      modelRef = null;
      currentSnapshot = null;
      serialized = null;
      publishRenderModel(null);
      snapshotListeners.clear();
    },
    async edit(operations) {
      if (!modelRef) throw new Error("xlsx_editor_not_open");
      await options.runtime.edit(modelRef, operations);
      currentSnapshot = cloneSnapshot(options.runtime.snapshot(modelRef));
      generation += 1;
      serialized = null;
      publishSnapshot();
    },
    getWorkbookSnapshot: () => currentSnapshot ? cloneSnapshot(currentSnapshot) : null,
    subscribeSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
  };

  const recalculate: XlsxRecalcController | undefined = options.runtime.recalculate
    ? {
        async run(signal, onProgress) {
          if (!modelRef || !currentSnapshot || !options.runtime.recalculate) throw new Error("xlsx_editor_not_open");
          if (signal.aborted) throw new DOMException("recalculation cancelled", "AbortError");
          const result = await options.runtime.recalculate(modelRef, signal, onProgress);
          if (signal.aborted) throw new DOMException("recalculation cancelled", "AbortError");
          if (disposed || !modelRef) throw new Error("xlsx_editor_disposed");
          currentSnapshot = cloneSnapshot(options.runtime.snapshot(modelRef));
          generation += 1;
          publishSnapshot();
          return result;
        },
        async cancel() {
          if (modelRef) await options.runtime.cancelRecalculate?.(modelRef);
        },
      }
    : undefined;
  if (recalculate) editor.recalculate = recalculate;

  const onRecoverSnapshot = options.runtime.restore
    ? async (snapshot: StableSnapshot<XlsxWorkbookSnapshot>): Promise<void> => {
        if (disposed) throw new Error("xlsx_editor_disposed");
        if (!modelRef) await editor.open();
        if (!modelRef || !options.runtime.restore) throw new Error("xlsx_editor_not_open");
        await options.runtime.restore(modelRef, cloneSnapshot(snapshot.value));
        currentSnapshot = cloneSnapshot(options.runtime.snapshot(modelRef));
        generation = Math.max(generation, snapshot.generation);
        serialized = null;
        publishSnapshot();
      }
    : undefined;

  const transport = createXlsxSaveTransport({
    documents: options.documents,
    documentId: options.identity.documentId,
    engineVersion: options.capability.engineBuild,
    contractVersion: options.capability.contractRevision,
    protocolVersion: "1",
    runtime: options.runtime,
    serialize: async () => {
      if (!modelRef) throw new Error("xlsx_editor_not_open");
      const out = await options.runtime.serialize(modelRef);
      serialized = { bytes: bytesOf(out.bytes), checksum: out.checksum, warnings: out.warnings };
      return out;
    },
  });
  const boundTransport: OfficeSaveTransport<XlsxWorkbookSnapshot> = {
    ...transport,
    serialize: transport.serialize,
  };
  const session = createOfficeEditorSession({ ...options, editor, transport: boundTransport });
  const open = {
    open: async (signal?: AbortSignal): Promise<XlsxOpenOutcome> => {
      if (signal?.aborted) return { outcome: "failed", document_id: options.identity.documentId, format: "xlsx", failure_class: "engine_error", message: "open cancelled" };
      try {
        await editor.open();
        return { outcome: "opened", document_id: options.identity.documentId, document_model_ref: modelRef!, snapshot: editor.getWorkbookSnapshot?.() ?? undefined };
      } catch (error) {
        const typed = error as Partial<XlsxRuntimeOpenError>;
        return {
          outcome: "failed",
          document_id: options.identity.documentId,
          format: "xlsx",
          failure_class: typed.failureClass ?? "engine_error",
          ...(typed.engineError ? { engine_error: typed.engineError } : {}),
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
  const editorView = createElement(XlsxEditorView, {
    modelRef: renderModelRef,
    documentKey: options.identity.documentId,
    editor,
    open,
    coordinator: session.coordinator as XlsxSaveCoordinator,
    title: options.title,
    capability: { ...options.capability, operation: "edit" },
    permissions: { canEdit: !options.readonly && options.capability.status === "available" },
    className: options.editorClassName,
  } as never);
  return { session, editor, capability: options.capability, editorView, open, onRecoverSnapshot };
}
