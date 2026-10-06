import type { OfficeFormat, OfficeHostAdapter, OpenOutcome } from "@uniwork/office-contracts";
import type { DesktopIpcChannel, DesktopIpcRequest, DesktopOfficeOpenResponse, DesktopOfficeSaveResponse } from "../../shared/ipc";
import { isDesktopDocumentFormat, type DesktopDocumentFormat } from "../../shared/document-formats";
import type { LibraryBridge } from "../library/model";
import { incomingBytes } from "./bytes";

export type DesktopOfficeContext = Readonly<{ sessionGeneration: string; workspaceId: string; documentId: string; version?: number }>;

export type DesktopOfficeHostOptions = Readonly<{
  bridge: LibraryBridge;
  context: DesktopOfficeContext;
  assets?: OfficeHostAdapter["assets"];
  worker?: OfficeHostAdapter["worker"];
}>;

/** Host injection used by shared Office views. It exposes the cloud Document
 * id to G2 and keeps all network/file authority behind the main IPC bridge. */
export function createDesktopOfficeHost(options: DesktopOfficeHostOptions): OfficeHostAdapter {
  const call = <C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>) => options.bridge.call(channel, payload);
  const readDocument = async (documentId: string): Promise<Uint8Array> => {
    const result = await call("desktop:library-download", { sessionGeneration: options.context.sessionGeneration, workspaceId: options.context.workspaceId, documentId, ...(options.context.version === undefined ? {} : { version: options.context.version }) }) as { data: Uint8Array };
    return incomingBytes(result.data);
  };
  const openDocument = async (documentId: string, format: OfficeFormat): Promise<OpenOutcome> => {
    if (!isDesktopDocumentFormat(format)) return { outcome: "failed", document_id: documentId, format, failure_class: "unsupported_feature", message: "format is outside the desktop host table" };
    try {
      const result = await call("desktop:office-open", { sessionGeneration: options.context.sessionGeneration, workspaceId: options.context.workspaceId, documentId, ...(options.context.version === undefined ? {} : { version: options.context.version }) }) as DesktopOfficeOpenResponse;
      return { outcome: "opened", document_id: documentId, document_model_ref: `desktop:${result.document.id}:${result.document.revision}`, warnings: [] };
    } catch {
      return { outcome: "failed", document_id: documentId, format, failure_class: "io_error", message: "Document could not be opened" };
    }
  };
  const writeOutput = async (documentId: string, bytes: Uint8Array): Promise<{ version_id?: string }> => {
    if (documentId !== options.context.documentId) throw new Error("document scope mismatch");
    // The actual save coordinator transport owns intent/key and calls the
    // typed save command. This low-level port intentionally refuses to write
    // without that context instead of creating an implicit second save path.
    void bytes;
    throw new Error("desktop write requires the Office save coordinator");
  };
  const ipc = {
    async call(channel: string, body: unknown): Promise<unknown> {
      if (!(channel as string).startsWith("host:")) throw new Error("unallowlisted office host channel");
      void body;
      throw new Error("desktop host channel is not bound");
    },
    send(channel: string): void { if (!(channel as string).startsWith("host:")) throw new Error("unallowlisted office host channel"); },
    subscribe(channel: string): () => void { if (!(channel as string).startsWith("host:")) throw new Error("unallowlisted office host channel"); return () => undefined; },
  };
  return {
    read: { readDocument, openDocument },
    write: { writeOutput },
    assets: options.assets ?? { resolveFont: async () => null, resolveImage: async () => null, resolveAsset: async () => null },
    ...(options.worker ? { worker: options.worker } : {}),
    ipc: ipc as OfficeHostAdapter["ipc"],
  };
}

export type DesktopOfficeSaveTransportOptions<TSnapshot> = Readonly<{
  bridge: LibraryBridge;
  context: DesktopOfficeContext;
  /** The carried format whose bytes this transport commits. */
  format: DesktopDocumentFormat;
  /** One engine build identity per format; the receipt names it. */
  engineName?: string;
  engineVersion?: string;
  contractVersion?: string;
  serialize(input: { snapshot: TSnapshot; documentId: string }): Promise<{ bytes: Uint8Array; checksum: string }>;
}>;

/** Adapts the shared coordinator's serialize/upload/commit pipeline to one
 * main-process `desktop:office-save` command. Upload is represented by an
 * in-memory receipt; commit is the only cloud mutation and carries the same
 * intent id, idempotency key, base pair and serialized bytes. The format is
 * carried on the request so main selects the right upload MIME/filename. */
export function createDesktopOfficeSaveTransport<TSnapshot>(options: DesktopOfficeSaveTransportOptions<TSnapshot>) {
  const outputs = new Map<string, { bytes: Uint8Array; checksum: string }>();
  return {
    async serialize(input: { intent: { intentId: string; identity: { documentId: string } }; snapshot: { value: TSnapshot } }) {
      const result = await options.serialize({ snapshot: input.snapshot.value, documentId: input.intent.identity.documentId });
      outputs.set(input.intent.intentId, result);
      return { data: result.bytes, checksumSha256: result.checksum, sizeBytes: result.bytes.byteLength, format: options.format };
    },
    async upload(input: { intent: { intentId: string; idempotencyKey: string }; output: { checksumSha256: string; sizeBytes: number } }) {
      return { uploadId: `desktop-upload:${input.intent.intentId}`, checksumSha256: input.output.checksumSha256, sizeBytes: input.output.sizeBytes, claimExpiresAt: new Date(Date.now() + 120_000).toISOString() };
    },
    async commit(input: { intent: { intentId: string; idempotencyKey: string; identity: { documentId: string; baseVersionId: string; baseRevision: string } }; upload: { checksumSha256: string } }) {
      const output = outputs.get(input.intent.intentId);
      if (!output) throw new Error("desktop save output missing");
      const result = await options.bridge.call("desktop:office-save", { sessionGeneration: options.context.sessionGeneration, workspaceId: options.context.workspaceId, documentId: input.intent.identity.documentId, format: options.format, intentId: input.intent.intentId, idempotencyKey: input.intent.idempotencyKey, baseVersionId: input.intent.identity.baseVersionId, baseRevision: input.intent.identity.baseRevision, data: output.bytes, checksum: input.upload.checksumSha256 }) as DesktopOfficeSaveResponse;
      outputs.delete(input.intent.intentId);
      return { intentId: result.intentId, idempotencyKey: result.idempotencyKey, documentId: result.documentId, versionId: result.versionId, revision: result.revision, checksumSha256: result.checksum, sizeBytes: output.bytes.byteLength, engineName: options.engineName ?? options.format, engineVersion: options.engineVersion ?? "desktop", contractVersion: options.contractVersion ?? ["uniwork", "office", "engine-contract"].join("-") + "/1", protocolVersion: "1" };
    },
    async reconcile() { return null; },
  };
}
