// DOCX adapter — implements the @uniwork/office-contracts OfficeEngineAdapter
// surface for format "docx" against the real-engine seam in ./engine.
//
// P3: open failures return a typed OpenOutcome bound to document_id — a
//   failed open can never produce an empty document on the save path
//   (there IS no session for the serialize call to find).
// P5: password intent state (set/clear/revision) rides in DocPasswordIntents;
//   serialize either re-encrypts through the bound crypto seam or refuses by
//   policy — it never writes plaintext over an encrypted source, and the
//   secret never enters a result, warning or log.
import {
  ENGINE_LIMITS,
  EngineBoundaryError,
  HostCapabilityRefusal,
  sha256Hex,
  type CapabilityEntry,
  type EngineErrorCode,
  type OfficeFormat,
  type OpenFailureClass,
  type OpenOutcome,
} from "@uniwork/office-contracts";
import type { OoxmlCrypto } from "./engine";
import type { DocxBlock, DocxEngineFunctions, DocxNumberingDef, DocxParsed } from "./engine";
import { DocxSessionModel, editableIndexes, visibleIndexes, type DocxEdit } from "./model";
import { DocPasswordIntents } from "./password";
import { inventoryDocxAssets, unsupportedDocxWarnings, type DocxAssetInventory } from "./assets";

// ── package sniffing (upstream isEncryptedDocx, docx-encryption.ts:24-31) ──

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENCRYPTED_STREAM = "EncryptedPackage";

function isZipPackage(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

/** ECMA-376 encrypted OOXML: CFB magic + an EncryptedPackage stream name
 * stored UTF-16LE in the CFB directory — same two markers as upstream. */
export function isEncryptedOoxml(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || !CFB_MAGIC.every((b, i) => bytes[i] === b)) return false;
  const needle = Array.from(ENCRYPTED_STREAM).flatMap((c) => [c.charCodeAt(0), 0]);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// ── adapter ────────────────────────────────────────────────────────────────

export interface DocxAdapterDeps {
  engine: DocxEngineFunctions;
  /** OOXML crypto seam — decrypt required for encrypted-open, encrypt optional
   * (absent => encrypted-source saves are a typed policy refusal, or the
   * intent state rides to the service through the grant). */
  crypto?: OoxmlCrypto;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  maxInputBytes?: number;
  /** Enumerate package part names for the asset oracle (seam may supply). */
  listPackageParts?: (parsed: DocxParsed) => string[];
}

interface DocxSession {
  ref: string;
  documentId: string;
  model: DocxSessionModel;
  assets: DocxAssetInventory;
  encryptedSource: boolean;
}

let sessionCounter = 0;

export class DocxAdapter {
  private sessions = new Map<string, DocxSession>();
  private passwords = new DocPasswordIntents();
  constructor(private deps: DocxAdapterDeps) {}

  /** P5 intent API — set/clear desired password for the NEXT save.
   * Returns the issued revision (the value a service grant cites). */
  setPasswordIntent(documentId: string, password: string | null): number {
    return this.passwords.setIntent(documentId, password);
  }

  passwordIntentRevision(documentId?: string): number {
    return documentId === undefined
      ? this.passwords.intentRevision()
      : this.passwords.intentRevisionOf(documentId);
  }

  /** The user dismissed the password prompt — upstream cancelDocPwd path.
   * Returns the typed failure the host surfaces as the open result. */
  cancelPassword(documentId: string): OpenOutcome {
    return this.failed(documentId, "password_cancelled", "password prompt dismissed by the user");
  }

  private failed(
    documentId: string,
    failureClass: OpenFailureClass,
    message?: string,
    engineError?: EngineErrorCode,
  ): OpenOutcome {
    return {
      outcome: "failed",
      document_id: documentId,
      format: "docx",
      failure_class: failureClass,
      ...(message ? { message } : {}),
      ...(engineError ? { engine_error: engineError } : {}),
    };
  }

  /** Map an engine failure to the contract's open failure classes — the
   * caller branches on the class, never on message text. */
  private mapParseError(documentId: string, error: unknown): OpenOutcome {
    if (error instanceof EngineBoundaryError) {
      return this.failed(documentId, "engine_error", error.message, error.code);
    }
    if (error instanceof HostCapabilityRefusal) {
      return this.failed(documentId, "engine_error", error.message, error.engine_error ?? "engine_crashed");
    }
    // The crypto seam tags its failures with a typed `reason` token
    // (vendor.ts bindDocxCrypto) — branch on it first; message matching is
    // only the fallback for seam errors that carry no token.
    const reason = (error as { reason?: unknown })?.reason;
    if (reason === "wrong-password") {
      return this.failed(documentId, "wrong_password", "decrypt refused the supplied password");
    }
    if (reason === "unsupported") {
      return this.failed(documentId, "unsupported_feature", "encrypted payload uses a scheme this build cannot decrypt");
    }
    const message = String((error as Error)?.message ?? error);
    const lower = message.toLowerCase();
    if (/password is incorrect|wrong-password/.test(lower)) {
      return this.failed(documentId, "wrong_password", "decrypt refused the supplied password");
    }
    if (/unsupported|docxdecrypterror/.test(lower)) {
      return this.failed(documentId, "unsupported_feature", message);
    }
    if (/opendocument|odf mime|\.odt|not ooxml/.test(lower)) {
      return this.failed(documentId, "not_office_file", "OpenDocument bytes, not an OOXML .docx package");
    }
    if (/not a valid zip|corrupted zip|end of central directory|eocd|not a zip/.test(lower)) {
      return this.failed(documentId, "corrupted", "package claims ZIP/OOXML but the container is broken");
    }
    if (/not a docx|missing word\/document\.xml|document\.xml/.test(lower)) {
      return this.failed(documentId, "corrupted", message);
    }
    return this.failed(documentId, "corrupted", message);
  }

  async open(input: {
    bytes: Uint8Array;
    format: OfficeFormat;
    document_id: string;
    locale?: string;
    /** docx-only extension: the collected password for encrypted sources.
     * Travels as a call argument, never inside a logged envelope. */
    password?: string;
  }): Promise<OpenOutcome> {
    const { bytes, document_id } = input;
    if (input.format !== "docx") {
      throw new EngineBoundaryError("unsupported_operation", { format: input.format, expected: "docx" });
    }
    const max = this.deps.maxInputBytes ?? ENGINE_LIMITS.max_input_bytes;
    if (bytes.length > max) {
      return this.failed(document_id, "too_large", "input " + bytes.length + " exceeds the " + max + " byte bound");
    }

    // ECMA-376 path: prompt → decrypt → parse the PLAINTEXT, remember the
    // disk password for the save path. No decryptor bound => a named
    // password_required/unsupported, never a blank document (P3).
    if (isEncryptedOoxml(bytes)) {
      if (input.password === undefined) {
        return this.failed(document_id, "password_required", "encrypted package — collect the password and retry open");
      }
      if (!this.deps.crypto?.decrypt) {
        return this.failed(document_id, "unsupported_feature", "encrypted source but no decryptor is bound to this adapter");
      }
      let plain: Uint8Array;
      try {
        plain = await this.deps.crypto.decrypt(bytes, input.password);
      } catch (error) {
        return this.mapParseError(document_id, error);
      }
      const parsed = await this.parseOrFail(document_id, plain, { encryptedSource: true });
      if (parsed.outcome !== "opened") return parsed;
      this.passwords.rememberDiskPassword(document_id, input.password);
      return parsed;
    }

    if (!isZipPackage(bytes)) {
      return this.failed(document_id, "not_office_file", "bytes are not a ZIP/OOXML container");
    }
    return this.parseOrFail(document_id, bytes);
  }

  private async parseOrFail(
    documentId: string,
    plainBytes: Uint8Array,
    opts: { encryptedSource?: boolean } = {},
  ): Promise<OpenOutcome> {
    let parsed: DocxParsed;
    try {
      parsed = await this.deps.engine.parseDocx(plainBytes);
    } catch (error) {
      return this.mapParseError(documentId, error);
    }
    if (!parsed || !Array.isArray(parsed.blocks)) {
      return this.failed(documentId, "corrupted", "engine returned a parse result without a block list");
    }
    const parts = this.deps.listPackageParts?.(parsed);
    const assets = inventoryDocxAssets(parsed, parts);
    const warnings = unsupportedDocxWarnings(assets);
    sessionCounter += 1;
    const ref = "docx-session-" + sessionCounter;
    this.sessions.set(ref, {
      ref,
      documentId,
      model: new DocxSessionModel(parsed),
      assets,
      encryptedSource: opts.encryptedSource === true || this.passwords.isEncryptedSource(documentId),
    });
    return { outcome: "opened", document_id: documentId, document_model_ref: ref, warnings };
  }

  /** Session-bound edit channel: the host calls with typed DocxEdit ops. */
  edit(documentModelRef: string, edit: DocxEdit): { applied: true; revision: number } {
    const session = this.sessionOf(documentModelRef);
    session.model.applyEdit(edit);
    return { applied: true, revision: session.model.revision };
  }

  sessionOf(documentModelRef: string): DocxSession {
    const session = this.sessions.get(documentModelRef);
    if (!session) {
      throw new EngineBoundaryError("not_found", { document_model_ref: documentModelRef });
    }
    return session;
  }

  /** Release a session (the contract's cancel path): frees the model and —
   * only when no other live session shares the document — both password
   * channels. Returns false when the ref was already gone. */
  release(documentModelRef: string): boolean {
    const session = this.sessions.get(documentModelRef);
    if (!session) return false;
    this.sessions.delete(documentModelRef);
    const stillOpen = [...this.sessions.values()].some((s) => s.documentId === session.documentId);
    if (!stillOpen) this.passwords.forget(session.documentId);
    return true;
  }

  async serialize(input: {
    document_model_ref: string;
    format: OfficeFormat;
  }): Promise<{ bytes: Uint8Array; checksum: string; warnings?: unknown[] }> {
    const session = this.sessionOf(input.document_model_ref);
    if (input.format !== "docx") {
      throw new EngineBoundaryError("unsupported_operation", { format: input.format, expected: "docx" });
    }
    const { finalBlocks, options } = session.model.savePlan();
    let out: Uint8Array;
    try {
      out = await this.deps.engine.saveDocx(session.model.parsed, finalBlocks, options);
    } catch (error) {
      if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
      throw new EngineBoundaryError("engine_crashed", { detail: String((error as Error)?.message ?? error) });
    }
    if (!out || out.length === 0) {
      throw new EngineBoundaryError("engine_result_invalid", { detail: "saveDocx returned empty bytes" });
    }
    if (out.length > ENGINE_LIMITS.max_output_bytes) {
      throw new EngineBoundaryError("upload_bounds", { detail: "output exceeds byte bound" });
    }

    // P5: effective password = intent ?? disk. Re-encrypt through the seam
    // when bound; otherwise a typed policy refusal — never plaintext over an
    // encrypted source (upstream recovery rule, docx-encryption.ts:163-168).
    // Every fallible step runs BEFORE commitSave: a failure here must not
    // advance disk/intent state for a save the caller never received.
    const snap = this.passwords.snapshot(session.documentId);
    let wire = out;
    if (snap.password !== null) {
      if (!this.deps.crypto?.encrypt) {
        throw new HostCapabilityRefusal(
          "docx:save",
          "policy",
          "source is password-protected and no re-encryption path is bound; carry intent revision " +
            (snap.intentRevision ?? "disk") + " to the service or clear the intent",
          "unsupported_operation",
        );
      }
      try {
        wire = await this.deps.crypto.encrypt(out, snap.password);
      } catch (error) {
        if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
        throw new EngineBoundaryError("engine_crashed", { detail: "re-encryption failed" });
      }
    }

    // Two-save rule: the produced bytes become the new base. Re-parse the
    // PLAINTEXT output so the next plan patches forward from what was saved.
    let rebased: DocxParsed;
    try {
      rebased = await this.deps.engine.parseDocx(out);
    } catch (error) {
      if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
      throw new EngineBoundaryError("engine_result_invalid", { detail: "saved plaintext does not re-parse" });
    }
    const hash = this.deps.sha256 ?? sha256Hex;
    const checksum = await hash(wire);
    // Only after every fallible step: rebase the model, refresh the asset
    // oracle and commit the password state — a failed save changes nothing.
    session.model.rebase(rebased);
    session.assets = inventoryDocxAssets(rebased, this.deps.listPackageParts?.(rebased));
    this.passwords.commitSave(session.documentId, snap);
    return { bytes: wire, checksum, warnings: [] };
  }

  /** Honest capability rows for format docx (G0 module-runtime-map states).
   * Rows proven by the vendored-engine fixture replay (G2-03b) carry
   * evidence_level "proven" — the only level the product surface may call
   * supported. Service-side rows stay pending with their proving test. */
  async capability(format: OfficeFormat): Promise<Record<string, unknown>> {
    if (format !== "docx") {
      throw new EngineBoundaryError("unsupported_operation", { format, expected: "docx" });
    }
    const rows: CapabilityEntry[] = [
      {
        operation: "open",
        supported: true,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: docx-open on vendored docx-engine (F-DOCX-SIMPLE/KITCHEN)",
      },
      {
        operation: "edit",
        supported: true,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: paragraph/table/image/header-footer edits verified by jszip extraction",
      },
      {
        operation: "serialize",
        supported: true,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: no-op byte-identity + two-save rebase on saveDocx",
      },
      {
        operation: "convert",
        supported: false,
        runtime: "internal_service",
        evidence_level: "pending",
        reason: "service-side job (G2-02); needs DOM/render drivers, no lab channel",
      },
      {
        operation: "export",
        supported: false,
        runtime: "internal_service",
        evidence_level: "pending",
        reason: "export path has no working channel; unsupported_operation is the honest answer",
      },
      {
        operation: "encrypted-open",
        supported: this.deps.crypto?.decrypt !== undefined,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: required/wrong/correct paths on F-DOCX-PWD-STANDARD + F-DOCX-PWD-AGILE (officecrypto-tool)",
      },
      {
        operation: "encrypted-save",
        supported: this.deps.crypto?.encrypt !== undefined,
        runtime: "browser",
        evidence_level: "proven",
        reason: "G2-03b replay: decrypt→edit→save→reopen stays encrypted with the same password; unbound still refuses by policy",
      },
    ];
    return { format: "docx", rows };
  }

  /** Inspection helpers for hosts/tests — honest model state, never a copy. */
  visibleIndexes(ref: string): number[] {
    return visibleIndexes(this.sessionOf(ref).model.parsed);
  }

  editableIndexes(ref: string): number[] {
    return editableIndexes(this.sessionOf(ref).model.parsed);
  }

  isDirty(ref: string): boolean {
    return this.sessionOf(ref).model.isDirty;
  }

  /** Read-only block inventory for a rendering host — the model's own blocks,
   * never a copy with inferred fields. A view binds an editing surface to
   * this; it must never reach the session model directly (adapter.ts is the
   * only seam between the engine and a host). */
  blocksOf(ref: string): DocxBlock[] {
    return this.sessionOf(ref).model.blocks;
  }

  /** Numbering definitions (numId -> def) of the open model, from the parse
   * (word/numbering.xml). A renderer needs them to draw the document's real
   * list markers/levels; empty when the parse carried none. */
  numberingOf(ref: string): Map<string, DocxNumberingDef> {
    const numbering = this.sessionOf(ref).model.parsed.numbering;
    return numbering instanceof Map ? numbering : new Map();
  }
}

export function createDocxAdapter(deps: DocxAdapterDeps): DocxAdapter {
  // Engines that can enumerate package parts feed the asset oracle; an
  // explicit dep always wins over an engine-supplied enumerator.
  const engineLister = (deps.engine as { listPackageParts?: (p: DocxParsed) => string[] }).listPackageParts;
  return new DocxAdapter(engineLister && !deps.listPackageParts ? { ...deps, listPackageParts: engineLister } : deps);
}
