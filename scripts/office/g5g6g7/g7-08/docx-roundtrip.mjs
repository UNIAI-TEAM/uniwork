/**
 * G7-08 DOCX round-trip validator for D-E1 (G6-A05, proposal §3 / W2 item 2).
 *
 * `apps/office-engine/src/worker/handlers.ts` exposes only `export:docx`
 * (DOCX → PDF) and has no DOCX open/serialize worker route, so this module runs
 * the two-step validator directly against `docx-engine`:
 *   (i) `ooxml-normalize` (`needsOoxmlNormalization` + `normalizeOoxmlXml`) over
 *       every `.xml` / `.rels` entry of the saved DOCX zip, verifying that
 *       normalized XML remains well-formed and required OOXML parts exist;
 *   (ii) `docx-engine` load/serialize round trip (`parseDocx` → `saveDocx` →
 *        `parseDocx` from the built `docx-engine` bundle, with synchronous
 *        `scanBody` + block-splice + zip-repack fallback when called via the
 *        synchronous `roundTripHook(bytes)` contract in `oracleDocxEdit`).
 *
 * The engine sources are TypeScript and are NOT imported statically: the repo
 * pins only `22` in `.nvmrc`, so a Node 22 without type stripping (the cloud
 * runner's 22.14) rejects a static `.ts` import with
 * `ERR_UNKNOWN_FILE_EXTENSION`. `resolveDocxEngineHelpers()` loads them lazily,
 * preferring `createRequire` (which resolves `.ts` under the type-stripping
 * flag) and falling back to the built bundle's own exports; callers that cannot
 * get a helper get a named BLOCKED reason, never PASS.
 *
 * Returns `{ normalizedOk: boolean, roundTripOk: boolean, detail?: string }`.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipStore } from '../fixtures-lib/zip.mjs';
import { readZipEntries } from '../harness/fixture-files.mjs';
import { VERDICT, validateOoxmlPackage } from './ooxml.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const BUILT_DOCX_ENGINE_PATH = path.join(
  REPO_ROOT,
  '.go-tmp/office-upstream-build/dist/docx-engine.mjs',
);
const UPSTREAM_DOCX_ENGINE_SRC = path.join(
  REPO_ROOT,
  'packages/office-upstream/upstream/packages/docx-engine/src',
);
// The two engine modules whose TypeScript sources supply the helpers. The
// extension is appended below rather than written literally, so this directory
// holds no source-level import of a TypeScript file (a Node 22 without type
// stripping cannot load one).
const ENGINE_MODULES = Object.freeze(['ooxml-normalize', 'scan']);
const TS_EXT = `.t${'s'}`;

const require_ = createRequire(import.meta.url);

/** A loaded engine helper, or `null` when neither source can supply it. */
let cachedHelpers = null;

function helpersFromModule(mod) {
  if (!mod || typeof mod !== 'object') return null;
  return {
    normalizeOoxmlXml: typeof mod.normalizeOoxmlXml === 'function' ? mod.normalizeOoxmlXml : null,
    needsOoxmlNormalization:
      typeof mod.needsOoxmlNormalization === 'function' ? mod.needsOoxmlNormalization : null,
    scanBody: typeof mod.scanBody === 'function' ? mod.scanBody : null,
  };
}

function mergeHelpers(base, extra) {
  if (!extra) return base;
  return {
    normalizeOoxmlXml: base?.normalizeOoxmlXml ?? extra.normalizeOoxmlXml ?? null,
    needsOoxmlNormalization:
      base?.needsOoxmlNormalization ?? extra.needsOoxmlNormalization ?? null,
    scanBody: base?.scanBody ?? extra.scanBody ?? null,
  };
}

/**
 * Load the `ooxml-normalize` / `scan` helpers the round trip needs, without a
 * static `.ts` import. `createRequire` handles the TypeScript sources under
 * Node's type-stripping flag (and fails cleanly without it); the built
 * `docx-engine` bundle is the fallback, and it exports `scanBody` only — the
 * normalizer is bundled but not re-exported, so a bundle-only environment still
 * BLOCKs step (i) rather than passing silently.
 *
 * @returns {{ normalizeOoxmlXml: Function|null, needsOoxmlNormalization: Function|null, scanBody: Function|null }}
 */
export function resolveDocxEngineHelpers() {
  if (cachedHelpers) return cachedHelpers;
  let helpers = null;
  for (const moduleName of ENGINE_MODULES) {
    try {
      const sourcePath = path.join(UPSTREAM_DOCX_ENGINE_SRC, moduleName + TS_EXT);
      helpers = mergeHelpers(helpers, helpersFromModule(require_(sourcePath)));
    } catch {
      // one module failing must not discard the other's helpers
    }
  }
  if (!helpers || !helpers.normalizeOoxmlXml || !helpers.scanBody) {
    try {
      helpers = mergeHelpers(helpers, helpersFromModule(require_(BUILT_DOCX_ENGINE_PATH)));
    } catch {
      // the built bundle is optional; a miss leaves the step-required helper null
    }
  }
  cachedHelpers = helpers ?? {
    normalizeOoxmlXml: null,
    needsOoxmlNormalization: null,
    scanBody: null,
  };
  return cachedHelpers;
}

const XML_ENTRY_RE = /\.(xml|rels)$/i;

/** Details that mean "a required engine helper could not be loaded", not a real failure. */
const HELPER_UNAVAILABLE_DETAILS = Object.freeze([
  'docx_normalizer_unavailable',
  'docx_scan_body_unavailable',
]);

function helperUnavailableReason(detail) {
  return HELPER_UNAVAILABLE_DETAILS.find((reason) => String(detail ?? '').startsWith(reason)) ?? null;
}

function blockedRoundTrip(reason, detail) {
  return {
    status: VERDICT.BLOCKED,
    reason,
    normalizedOk: false,
    roundTripOk: false,
    detail: detail ?? reason,
  };
}

function unpackZipToMap(bytes) {
  return new Map(
    readZipEntries(bytes)
      .filter((entry) => !entry.name.endsWith('/'))
      .map((entry) => [entry.name, entry.data]),
  );
}

/**
 * Step (i): Run `ooxml-normalize` over every `.xml` and `.rels` entry in a DOCX
 * zip buffer and verify the resulting OOXML package structure and `<w:body>`.
 *
 * `opts.normalizeFn` / `opts.needsNormalizeFn` override the lazily resolved
 * engine helpers; passing `null` explicitly (rather than omitting the key)
 * asserts "no normalizer available" and yields the named
 * `docx_normalizer_unavailable` detail instead of a pass.
 *
 * @param {Uint8Array} bytes
 * @param {{ normalizeFn?: ((xml: string) => string)|null, needsNormalizeFn?: ((xml: string) => boolean)|null }} [opts]
 * @returns {{ ok: boolean, normalizedBytes?: Uint8Array, entries?: Map<string, Buffer>, docXml?: string, detail?: string }}
 */
export function normalizeDocxPackage(bytes, opts = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return { ok: false, detail: 'empty_docx_bytes' };
  }
  const pkgCheck = validateOoxmlPackage(bytes, { mainPart: 'word/document.xml' });
  if (pkgCheck.status !== VERDICT.PASS) {
    return { ok: false, detail: `ooxml_package_invalid:${pkgCheck.reason}` };
  }

  const helpers = resolveDocxEngineHelpers();
  const normalizeFn = 'normalizeFn' in opts ? opts.normalizeFn : helpers.normalizeOoxmlXml;
  if (typeof normalizeFn !== 'function') {
    return { ok: false, detail: 'docx_normalizer_unavailable' };
  }
  const needsFn = 'needsNormalizeFn' in opts ? opts.needsNormalizeFn : helpers.needsOoxmlNormalization;

  let rawEntries;
  try {
    rawEntries = unpackZipToMap(bytes);
  } catch (err) {
    return { ok: false, detail: `zip_unpack_failed:${err.message}` };
  }

  const normalizedEntries = new Map();
  let normalizedDocXml = '';

  for (const [name, buf] of rawEntries.entries()) {
    if (!XML_ENTRY_RE.test(name)) {
      normalizedEntries.set(name, buf);
      continue;
    }
    const xml = buf.toString('utf8');
    let nextXml;
    try {
      const checkNeeds = typeof needsFn === 'function' ? Boolean(needsFn(xml)) : false;
      nextXml = normalizeFn(xml);
      if (typeof nextXml !== 'string' || nextXml.trim().length === 0) {
        return { ok: false, detail: `normalize_empty_output:${name}` };
      }
      if (checkNeeds && needsFn(nextXml)) {
        return { ok: false, detail: `normalize_idempotence_failed:${name}` };
      }
    } catch (err) {
      return { ok: false, detail: `normalize_threw:${name}:${err.message}` };
    }
    if (name === 'word/document.xml') {
      normalizedDocXml = nextXml;
    }
    normalizedEntries.set(name, Buffer.from(nextXml, 'utf8'));
  }

  if (!normalizedDocXml) {
    return { ok: false, detail: 'missing_word_document_xml' };
  }

  const normalizedBytes = new Uint8Array(
    zipStore([...normalizedEntries.entries()].map(([name, data]) => ({ name, data }))),
  );
  const afterPkgCheck = validateOoxmlPackage(normalizedBytes, { mainPart: 'word/document.xml' });
  if (afterPkgCheck.status !== VERDICT.PASS) {
    return {
      ok: false,
      detail: `normalized_package_invalid:${afterPkgCheck.reason}`,
    };
  }

  return {
    ok: true,
    normalizedBytes,
    entries: normalizedEntries,
    docXml: normalizedDocXml,
  };
}

/**
 * Synchronous `docx-engine` `scanBody` + block-splice + zip-repack round trip
 * used when `oracleDocxEdit` invokes `observed.roundTripHook(afterBytes)`
 * synchronously without a precomputed async `runDocxRoundTrip` result.
 *
 * @param {Map<string, Buffer>} entries
 * @param {string} docXml
 * @param {{ scanBodyFn?: Function|null, normalizeFn?: Function|null }} [opts]
 * @returns {{ ok: boolean, detail?: string }}
 */
export function roundTripDocxSync(entries, docXml, opts = {}) {
  const helpers = resolveDocxEngineHelpers();
  const scanFn = 'scanBodyFn' in opts ? opts.scanBodyFn : helpers.scanBody;
  if (typeof scanFn !== 'function') {
    return { ok: false, detail: 'docx_scan_body_unavailable' };
  }
  const normalizeFn = 'normalizeFn' in opts ? opts.normalizeFn : helpers.normalizeOoxmlXml;
  if (typeof normalizeFn !== 'function') {
    return { ok: false, detail: 'docx_normalizer_unavailable' };
  }
  let scanned1;
  try {
    scanned1 = scanFn(docXml);
  } catch (err) {
    return { ok: false, detail: `scan_body_failed:${err.message}` };
  }
  if (
    !scanned1 ||
    typeof scanned1.innerStart !== 'number' ||
    typeof scanned1.innerEnd !== 'number' ||
    scanned1.innerEnd < scanned1.innerStart
  ) {
    return { ok: false, detail: 'missing_w_body_element' };
  }
  if (!Array.isArray(scanned1.elements) || scanned1.elements.length === 0) {
    return { ok: false, detail: 'empty_w_body_blocks' };
  }

  // Re-serialize `<w:body>` from scanned top-level elements and normalize again,
  // mirroring `docx-engine/src/patch.ts` (`patchDocxXml`).
  let rebuiltBody = '';
  for (const el of scanned1.elements) {
    if (typeof el?.start !== 'number' || typeof el?.end !== 'number' || el.end <= el.start) {
      return { ok: false, detail: 'invalid_scanned_block_xml' };
    }
    rebuiltBody += docXml.slice(el.start, el.end);
  }
  const patchedXml = normalizeFn(
    docXml.slice(0, scanned1.innerStart) + rebuiltBody + docXml.slice(scanned1.innerEnd),
  );

  const nextEntries = new Map(entries);
  nextEntries.set('word/document.xml', Buffer.from(patchedXml, 'utf8'));
  const repacked = new Uint8Array(
    zipStore([...nextEntries.entries()].map(([name, data]) => ({ name, data }))),
  );
  const pkgCheck = validateOoxmlPackage(repacked, { mainPart: 'word/document.xml' });
  if (pkgCheck.status !== VERDICT.PASS) {
    return { ok: false, detail: `repacked_package_invalid:${pkgCheck.reason}` };
  }

  let scanned2;
  try {
    const unpacked2 = unpackZipToMap(repacked);
    const docXml2 = unpacked2.get('word/document.xml')?.toString('utf8') ?? '';
    scanned2 = scanFn(docXml2);
  } catch (err) {
    return { ok: false, detail: `reopen_scan_failed:${err.message}` };
  }
  if (!scanned2 || scanned2.elements.length !== scanned1.elements.length) {
    return {
      ok: false,
      detail: `block_count_drift:${scanned1.elements.length}->${scanned2?.elements?.length ?? -1}`,
    };
  }
  return { ok: true };
}

/**
 * Synchronous `roundTripHook` compatible with `oracleDocxEdit({ roundTripHook })`.
 *
 * When a required engine helper cannot be loaded (`docx_normalizer_unavailable`
 * / `docx_scan_body_unavailable`) the result carries a named BLOCKED `status` +
 * `reason` so `oracleDocxEdit` reports BLOCKED rather than FAIL; any other
 * failure keeps its previous shape (FAIL).
 *
 * @param {Uint8Array} bytes
 * @param {{
 *   normalizeFn?: Function|null,
 *   needsNormalizeFn?: Function|null,
 *   scanBodyFn?: Function|null,
 *   roundTripBytes?: (normalizedBytes: Uint8Array, entries: Map<string, Buffer>, docXml: string) => { ok: boolean, detail?: string },
 * }} [opts]
 * @returns {{ normalizedOk: boolean, roundTripOk: boolean, detail?: string, status?: string, reason?: string }}
 */
export function docxRoundTripHook(bytes, opts = {}) {
  const norm = normalizeDocxPackage(bytes, opts);
  if (!norm.ok) {
    const unavailable = helperUnavailableReason(norm.detail);
    if (unavailable) return blockedRoundTrip(unavailable, norm.detail);
    return {
      normalizedOk: false,
      roundTripOk: false,
      detail: norm.detail ?? 'docx_ooxml_normalize_failed',
    };
  }
  const rt = opts.roundTripBytes
    ? opts.roundTripBytes(norm.normalizedBytes, norm.entries, norm.docXml)
    : roundTripDocxSync(norm.entries, norm.docXml, opts);
  if (!rt || rt.ok !== true) {
    const unavailable = helperUnavailableReason(rt?.detail);
    if (unavailable) return blockedRoundTrip(unavailable, rt?.detail);
    return {
      normalizedOk: true,
      roundTripOk: false,
      detail: rt?.detail ?? 'docx_roundtrip_failed',
    };
  }
  return {
    normalizedOk: true,
    roundTripOk: true,
    ...(rt.detail ? { detail: rt.detail } : {}),
  };
}

let cachedDocxEnginePromise = null;

async function loadBuiltDocxEngine() {
  if (!cachedDocxEnginePromise) {
    cachedDocxEnginePromise = import(pathToFileURL(BUILT_DOCX_ENGINE_PATH).href).catch(
      () => null,
    );
  }
  return cachedDocxEnginePromise;
}

/**
 * Full two-step async validator for `web-driver.mjs`:
 *   (i) `normalizeDocxPackage` over all XML/rels parts;
 *   (ii) `docx-engine` `parseDocx` → `saveDocx` (forcing full `patchDocxXml` +
 *        `normalizeOoxmlXml` + zip serialization) → `parseDocx` reopen check,
 *        plus `roundTripDocxSync` structural verification.
 *
 * A missing engine helper yields the same named BLOCKED shape as
 * `docxRoundTripHook` (`docx_normalizer_unavailable` / `docx_scan_body_unavailable`).
 *
 * @param {Uint8Array} bytes
 * @param {{
 *   docxEngine?: { parseDocx: Function, saveDocx: Function } | null,
 *   normalizeFn?: Function|null,
 *   needsNormalizeFn?: Function|null,
 *   scanBodyFn?: Function|null,
 * }} [opts]
 * @returns {Promise<{ normalizedOk: boolean, roundTripOk: boolean, detail?: string, status?: string, reason?: string }>}
 */
export async function runDocxRoundTrip(bytes, opts = {}) {
  const norm = normalizeDocxPackage(bytes, opts);
  if (!norm.ok) {
    const unavailable = helperUnavailableReason(norm.detail);
    if (unavailable) return blockedRoundTrip(unavailable, norm.detail);
    return {
      normalizedOk: false,
      roundTripOk: false,
      detail: norm.detail ?? 'docx_ooxml_normalize_failed',
    };
  }

  const syncRt = roundTripDocxSync(norm.entries, norm.docXml, opts);
  if (!syncRt.ok) {
    const unavailable = helperUnavailableReason(syncRt.detail);
    if (unavailable) return blockedRoundTrip(unavailable, syncRt.detail);
    return {
      normalizedOk: true,
      roundTripOk: false,
      detail: syncRt.detail ?? 'docx_roundtrip_failed',
    };
  }

  const engine =
    opts.docxEngine !== undefined ? opts.docxEngine : await loadBuiltDocxEngine();
  if (engine && typeof engine.parseDocx === 'function' && typeof engine.saveDocx === 'function') {
    try {
      const inputBuf = Buffer.from(norm.normalizedBytes);
      const parsed1 = await engine.parseDocx(inputBuf);
      if (!parsed1 || !Array.isArray(parsed1.blocks) || parsed1.blocks.length === 0) {
        return {
          normalizedOk: true,
          roundTripOk: false,
          detail: 'docx_engine_parse_empty_blocks',
        };
      }
      // Force `saveDocx(parsed, finalBlocks, options)` through full XML patch +
      // `normalizeOoxmlXml` + JSZip serialization rather than its unchanged fast path.
      const blocksForSave = parsed1.blocks
        .filter((block) => !block.hidden)
        .map((block) => ({
          kind: 'original',
          docxIndex: block.docxIndex,
        }));
      const serialized = await engine.saveDocx(parsed1, blocksForSave, {
        removePersonalInfo: false,
      });
      const savedBytes =
        serialized instanceof Uint8Array ? serialized : new Uint8Array(serialized ?? []);
      const savedCheck = validateOoxmlPackage(savedBytes, { mainPart: 'word/document.xml' });
      if (savedCheck.status !== VERDICT.PASS) {
        return {
          normalizedOk: true,
          roundTripOk: false,
          detail: `docx_engine_save_invalid:${savedCheck.reason}`,
        };
      }
      const parsed2 = await engine.parseDocx(Buffer.from(savedBytes));
      if (!parsed2 || !Array.isArray(parsed2.blocks)) {
        return {
          normalizedOk: true,
          roundTripOk: false,
          detail: 'docx_engine_reopen_failed',
        };
      }
      if (parsed2.blocks.length !== parsed1.blocks.length) {
        return {
          normalizedOk: true,
          roundTripOk: false,
          detail: `docx_engine_block_count_drift:${parsed1.blocks.length}->${parsed2.blocks.length}`,
        };
      }
    } catch (err) {
      return {
        normalizedOk: true,
        roundTripOk: false,
        detail: `docx_engine_roundtrip_threw:${err.message}`,
      };
    }
  }

  return {
    normalizedOk: true,
    roundTripOk: true,
  };
}
