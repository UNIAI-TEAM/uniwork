// DOCX vendored-engine binding — maps the packages/office-upstream build
// artifacts onto this lane's seam. The module objects arrive already imported
// (the node/desktop entry or the replay driver does the import()), so this
// file stays free of Node/fs/canvas and the browser boundary holds.
//
// Upstream surface bound here (pinned 09485f88):
//   dist/docx-engine.mjs        -> parseDocx / saveDocx
//   officecrypto-tool           -> decrypt / encrypt (docx-encryption.ts:43/56)
import { EngineBoundaryError, HostCapabilityRefusal } from "@uniwork/office-contracts";
import type {
  DocxEngineFunctions,
  DocxParsed,
  DocxParseOptions,
  DocxSaveBlock,
  DocxSaveOptions,
  OoxmlCrypto,
} from "./engine";

/** The docx-engine bundle's export surface (subset this seam consumes). */
export interface UpstreamDocxEngineModule {
  parseDocx(bytes: Uint8Array, options?: DocxParseOptions): Promise<DocxParsed>;
  saveDocx(parsed: DocxParsed, finalBlocks: DocxSaveBlock[], options?: DocxSaveOptions): Promise<Uint8Array>;
}

/** officecrypto-tool's surface (docx-encryption.ts:12 imports it default). */
export interface UpstreamOfficeCryptoModule {
  decrypt(bytes: Uint8Array, opts: { password: string }): Promise<Uint8Array>;
  encrypt(bytes: Uint8Array, opts: { password: string }): Uint8Array | Promise<Uint8Array>;
}

const toBytes = (out: unknown): Uint8Array => {
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (Array.isArray(out)) return new Uint8Array(out as number[]);
  if (out && typeof (out as { data?: number[] }).data === "object") return new Uint8Array((out as { data: number[] }).data);
  throw new EngineBoundaryError("engine_result_invalid", { detail: "crypto seam returned non-byte output" });
};

/** Key under parsed.internal where the optional part enumeration lands. */
export const DOCX_PACKAGE_PARTS_KEY = "packageParts";

/**
 * Bind the vendored docx-engine to the adapter seam. `enumerateParts` is the
 * optional package-name oracle the node host/replay supplies (jszip lister);
 * when present the parse wrapper stashes part names under
 * internal.packageParts and exposes them through listPackageParts.
 */
export function bindDocxEngine(
  mod: UpstreamDocxEngineModule,
  helpers?: { enumerateParts?: (bytes: Uint8Array) => Promise<string[]> },
): DocxEngineFunctions & { listPackageParts(parsed: DocxParsed): string[] } {
  return {
    async parseDocx(bytes: Uint8Array, options?: DocxParseOptions): Promise<DocxParsed> {
      const parsed = await mod.parseDocx(bytes, options);
      if (helpers?.enumerateParts && parsed && typeof parsed === "object") {
        try {
          const parts = await helpers.enumerateParts(bytes);
          parsed.internal = { ...(parsed.internal ?? {}), [DOCX_PACKAGE_PARTS_KEY]: parts };
        } catch {
          // enumeration is an oracle nicety; absence must not fail the open.
        }
      }
      return parsed;
    },
    saveDocx(parsed: DocxParsed, finalBlocks: DocxSaveBlock[], options?: DocxSaveOptions): Promise<Uint8Array> {
      return mod.saveDocx(parsed, finalBlocks, options);
    },
    listPackageParts(parsed: DocxParsed): string[] {
      const parts = (parsed.internal ?? {})[DOCX_PACKAGE_PARTS_KEY];
      return Array.isArray(parts) ? (parts as string[]) : [];
    },
  };
}

/**
 * Bind officecrypto-tool to the crypto seam, mirroring upstream
 * decryptDocx/encryptDocx (docx-encryption.ts:43-57) exactly: a verifier
 * mismatch surfaces as 'wrong-password', exotic schemes as 'unsupported', and
 * re-encryption uses the library's Agile path (Word 2013+ default). The
 * adapter's mapParseError reads these reason tokens, never a stack.
 */
export function bindDocxCrypto(officeCrypto: UpstreamOfficeCryptoModule): OoxmlCrypto {
  // officecrypto-tool is a CJS node lib: it wants Buffer inputs. `Buffer` is a
  // host global here — hosts only bind crypto on node/desktop, so reaching
  // this function without a Buffer global is a binding mistake we refuse
  // loudly instead of failing deep inside the library.
  if (typeof Buffer === "undefined") {
    throw new HostCapabilityRefusal(
      "docx:crypto",
      "unbound",
      "officecrypto-tool needs a Node Buffer host; bind the crypto seam only on node/desktop",
    );
  }
  const toBuf = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  return {
    async decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
      try {
        return toBytes(await officeCrypto.decrypt(toBuf(bytes), { password }));
      } catch (error) {
        // Our own typed errors (e.g. toBytes engine_result_invalid) pass
        // through untouched — only library failures get a reason token.
        if (error instanceof EngineBoundaryError || error instanceof HostCapabilityRefusal) throw error;
        const message = String((error as Error)?.message ?? error);
        const err = new Error(message.includes("password is incorrect") ? "wrong-password: " + message : "unsupported: " + message);
        (err as { reason?: string }).reason = message.includes("password is incorrect") ? "wrong-password" : "unsupported";
        throw err;
      }
    },
    async encrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
      return toBytes(await officeCrypto.encrypt(toBuf(bytes), { password }));
    },
  };
}
