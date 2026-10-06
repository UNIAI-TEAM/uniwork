import {
  ENGINE_LIMITS,
  EngineBoundaryError,
  HostCapabilityRefusal,
  sha256Hex,
  type CapabilityEntry,
  type FidelityWarning,
  type OfficeEngineAdapter,
  type OfficeFormat,
  type OpenOutcome,
  type Sha256HexFn,
} from "@uniwork/office-contracts";
import { emptyAssetManifest, parseAssetManifest, uniqueAssetKey, type AssetManifest } from "./manifest";
import { mediaTypeFor } from "./media";
import { planSaveAsRebase, rebasedPending, rebasedSource } from "./rebase";
import { relativeReference, sanitizeAssetName } from "./references";
import { saveWithAssets, type AssetBytesSource, type AssetSaveReport, type AssetStagingPort, type PublishInput } from "./save";

// The session core shared by the Markdown and HTML adapters. A text document
// is its SOURCE (plus BOM flag) and its asset manifest - never page JSON. The
// engine keeps sessions behind an opaque document_model_ref; bytes in, bytes
// out, and a save that carries assets goes through saveWithAssets.

type TextFormat = Extract<OfficeFormat, "md" | "html">;

/** What a format contributes: how to find and rewrite asset references in
 * its source. Markdown and HTML bind these to the upstream seam / scanner. */
export interface TextFormatDriver {
  format: TextFormat;
  /** Package-relative path a blank or pathless document takes. */
  default_document_path: string;
  scanReferences(text: string): string[];
  rewriteReferences(text: string, rewrites: ReadonlyMap<string, string>): string;
  /** The engine's honest capability rows for this format. */
  capabilities: readonly CapabilityEntry[];
}

export interface TextSnapshot {
  document_id: string;
  text: string;
  manifest: AssetManifest;
  references: string[];
  revision: number;
}

interface SavePorts<R> {
  source: AssetBytesSource;
  staging: AssetStagingPort;
  publish(input: PublishInput & { document_id: string }): Promise<R>;
}

interface TextSaveResult<R> {
  result: R;
  report: AssetSaveReport;
  warnings: FidelityWarning[];
}

export interface TextDocumentEngine extends OfficeEngineAdapter {
  open(input: {
    bytes: Uint8Array;
    format: OfficeFormat;
    document_id: string;
    locale?: string;
    /** The stored manifest of this version; absent means no assets yet. */
    asset_manifest?: unknown;
    document_path?: string;
  }): Promise<OpenOutcome>;
  createBlank(input: { document_id: string; document_path?: string }): { document_model_ref: string };
  snapshot(ref: string): TextSnapshot;
  replaceText(ref: string, text: string): TextSnapshot;
  addAsset(ref: string, input: { name: string; bytes: Uint8Array }): Promise<{ key: string; reference: string }>;
  save<R>(ref: string, ports: SavePorts<R>): Promise<TextSaveResult<R>>;
  saveAs<R>(
    ref: string,
    input: { target_document_id: string; target_document_path: string } & SavePorts<R>,
  ): Promise<TextSaveResult<R>>;
  close(ref: string): void;
}

interface Session {
  document_id: string;
  text: string;
  bom: boolean;
  manifest: AssetManifest;
  pending: Map<string, Uint8Array>;
  revision: number;
}

const BOM = [0xef, 0xbb, 0xbf] as const;

function decodeSource(bytes: Uint8Array): { text: string; bom: boolean } {
  const bom = bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
  // fatal: invalid UTF-8 is a corrupted open, never a U+FFFD-riddled document
  // that a later save would write back over the original.
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
  return { text, bom };
}

function encodeSource(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set(BOM, 0);
  out.set(body, 3);
  return out;
}

function preservationWarnings(report: AssetSaveReport): FidelityWarning[] {
  const kept = report.dangling_count + report.refused.length;
  // Counts only: a refused reference may itself be a host path, and warning
  // text is browser-facing.
  return kept === 0
    ? []
    : [{ code: "unsupported_construct_preserved", detail: kept + " asset reference(s) kept in the text without bytes" }];
}

function newRef(format: TextFormat): string {
  return format + "-session:" + crypto.randomUUID();
}

export function createTextDocumentEngine(
  driver: TextFormatDriver,
  options: { hash?: Sha256HexFn; maxInputBytes?: number } = {},
): TextDocumentEngine {
  const hash = options.hash ?? sha256Hex;
  // The server contract bound unless the host injects its own; a host that
  // does not cap local files passes Number.POSITIVE_INFINITY.
  const maxInputBytes = options.maxInputBytes ?? ENGINE_LIMITS.max_input_bytes;
  const sessions = new Map<string, Session>();

  function session(ref: string): Session {
    const found = sessions.get(ref);
    if (!found) throw new EngineBoundaryError("not_found", { reason: "unknown_document_model_ref" });
    return found;
  }

  function checkFormat(format: OfficeFormat, channel: string): void {
    if (format !== driver.format) {
      throw new HostCapabilityRefusal(channel, "unsupported", "this adapter serves " + driver.format + " only");
    }
  }

  function snapshotOf(s: Session): TextSnapshot {
    return {
      document_id: s.document_id,
      text: s.text,
      manifest: { ...s.manifest, entries: s.manifest.entries.map((e) => ({ ...e })) },
      references: driver.scanReferences(s.text),
      revision: s.revision,
    };
  }

  async function commit<R>(
    s: Session,
    text: string,
    manifest: AssetManifest,
    pending: ReadonlyMap<string, Uint8Array>,
    source: AssetBytesSource,
    documentId: string,
    ports: SavePorts<R>,
  ): Promise<TextSaveResult<R>> {
    const { result, report } = await saveWithAssets({
      text_bytes: encodeSource(text, s.bom),
      references: driver.scanReferences(text),
      manifest,
      pending,
      source,
      staging: ports.staging,
      hash,
      publish: (input) => ports.publish({ ...input, document_id: documentId }),
    });
    // Only a published save moves the session forward.
    s.document_id = documentId;
    s.text = text;
    s.manifest = report.manifest;
    s.pending = new Map();
    s.revision++;
    return { result, report, warnings: preservationWarnings(report) };
  }

  return {
    async capability(format) {
      checkFormat(format, "engine:capability");
      return {
        job_id: "capability-" + format,
        state: "completed",
        operation: "capability",
        format,
        capabilities: driver.capabilities.map((c) => ({ ...c })),
        limits: { max_input_bytes: maxInputBytes },
      };
    },

    async open(input) {
      checkFormat(input.format, "engine:open");
      const failed = (failure_class: "corrupted" | "too_large", message: string): OpenOutcome => ({
        outcome: "failed",
        document_id: input.document_id,
        format: input.format,
        failure_class,
        message,
      });
      if (input.bytes.byteLength > maxInputBytes) return failed("too_large", "document exceeds the input bound");
      let decoded: { text: string; bom: boolean };
      try {
        decoded = decodeSource(input.bytes);
      } catch {
        return failed("corrupted", "document is not valid UTF-8 text");
      }
      const manifest =
        input.asset_manifest === undefined
          ? emptyAssetManifest(input.document_path ?? driver.default_document_path)
          : parseAssetManifest(input.asset_manifest);
      const ref = newRef(driver.format);
      sessions.set(ref, { document_id: input.document_id, ...decoded, manifest, pending: new Map(), revision: 0 });
      return { outcome: "opened", document_id: input.document_id, document_model_ref: ref, warnings: [] };
    },

    createBlank(input) {
      const ref = newRef(driver.format);
      const manifest = emptyAssetManifest(input.document_path ?? driver.default_document_path);
      sessions.set(ref, { document_id: input.document_id, text: "", bom: false, manifest, pending: new Map(), revision: 0 });
      return { document_model_ref: ref };
    },

    snapshot: (ref) => snapshotOf(session(ref)),

    replaceText(ref, text) {
      const s = session(ref);
      if (text !== s.text) {
        s.text = text;
        s.revision++;
      }
      return snapshotOf(s);
    },

    async addAsset(ref, input) {
      const s = session(ref);
      if (input.bytes.byteLength > maxInputBytes) {
        throw new EngineBoundaryError("upload_bounds", { reason: "asset_too_large" });
      }
      const key = uniqueAssetKey(s.manifest, sanitizeAssetName(input.name));
      const bytes = input.bytes.slice();
      s.manifest.entries.push({
        key,
        sha256: await hash(bytes),
        byte_length: bytes.byteLength,
        media_type: mediaTypeFor(key, bytes),
        origin: "owned",
      });
      s.pending.set(key, bytes);
      return { key, reference: relativeReference(key, s.manifest.document_path) };
    },

    async serialize(input) {
      checkFormat(input.format, "engine:serialize");
      const s = session(input.document_model_ref);
      const bytes = encodeSource(s.text, s.bom);
      return { bytes, checksum: await hash(bytes), warnings: [] };
    },

    save(ref, ports) {
      const s = session(ref);
      return commit(s, s.text, s.manifest, s.pending, ports.source, s.document_id, ports);
    },

    async saveAs(ref, input) {
      const s = session(ref);
      const plan = planSaveAsRebase(s.manifest, driver.scanReferences(s.text), input.target_document_path);
      const text = driver.rewriteReferences(s.text, plan.text_rewrites);
      // Prove the rewrite landed: every replacement must be found again by the
      // same scanner, or the new document would reopen without that asset.
      const found = new Set(driver.scanReferences(text));
      for (const replacement of plan.text_rewrites.values()) {
        if (!found.has(replacement)) {
          throw new EngineBoundaryError("commit_failed", { reason: "asset_rewrite_unverified" });
        }
      }
      return commit(
        s,
        text,
        plan.manifest,
        rebasedPending(s.pending, plan.copies),
        rebasedSource(input.source, plan.copies),
        input.target_document_id,
        input,
      );
    },

    close(ref) {
      sessions.delete(ref);
    },
  };
}
