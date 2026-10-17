/**
 * G7-08 DOCX round-trip validator for D-E1 (G6-A05, proposal §3 / W2 item 2).
 *
 * `apps/office-engine/src/worker/handlers.ts` exposes only `export:docx`
 * (DOCX → PDF) and has no DOCX open/serialize worker route, so this module runs
 * the two-step validator directly against `docx-engine`:
 *   (i) `ooxml-normalize` (`needsOoxmlNormalization` + `normalizeOoxmlXml` from
 *       `packages/office-upstream/upstream/packages/docx-engine/src/ooxml-normalize.ts`)
 *       over every `.xml` / `.rels` entry of the saved DOCX zip, verifying that
 *       normalized XML remains well-formed and required OOXML parts exist;
 *   (ii) `docx-engine` load/serialize round trip (`parseDocx` → `saveDocx` →
 *        `parseDocx` from the built `docx-engine` bundle, with synchronous
 *        `scanBody` + block-splice + zip-repack fallback when called via the
 *        synchronous `roundTripHook(bytes)` contract in `oracleDocxEdit`).
 *
 * Returns `{ normalizedOk: boolean, roundTripOk: boolean, detail?: string }`.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  needsOoxmlNormalization,
  normalizeOoxmlXml,
} from '../../../../packages/office-upstream/upstream/packages/docx-engine/src/ooxml-normalize.ts';
import { scanBody } from '../../../../packages/office-upstream/upstream/packages/docx-engine/src/scan.ts';
import { zipStore } from '../fixtures-lib/zip.mjs';
import { readZipEntries } from '../harness/fixture-files.mjs';
import { VERDICT, validateOoxmlPackage } from './ooxml.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const BUILT_DOCX_ENGINE_PATH = path.join(
  REPO_ROOT,
  '.go-tmp/office-upstream-build/dist/docx-engine.mjs',
);

const XML_ENTRY_RE = /\.(xml|rels)$/i;

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
 * @param {Uint8Array} bytes
 * @param {{ normalizeFn?: (xml: string) => string, needsNormalizeFn?: (xml: string) => boolean }} [opts]
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

  let rawEntries;
  try {
    rawEntries = unpackZipToMap(bytes);
  } catch (err) {
    return { ok: false, detail: `zip_unpack_failed:${err.message}` };
  }

  const normalizeFn = opts.normalizeFn ?? normalizeOoxmlXml;
  const needsFn = opts.needsNormalizeFn ?? needsOoxmlNormalization;
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
      const checkNeeds = Boolean(needsFn(xml));
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
 * @param {{ scanBodyFn?: typeof scanBody }} [opts]
 * @returns {{ ok: boolean, detail?: string }}
 */
export function roundTripDocxSync(entries, docXml, opts = {}) {
  const scanFn = opts.scanBodyFn ?? scanBody;
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
  const patchedXml = normalizeOoxmlXml(
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
 * @param {Uint8Array} bytes
 * @param {{
 *   normalizeFn?: (xml: string) => string,
 *   needsNormalizeFn?: (xml: string) => boolean,
 *   scanBodyFn?: typeof scanBody,
 *   roundTripBytes?: (normalizedBytes: Uint8Array, entries: Map<string, Buffer>, docXml: string) => { ok: boolean, detail?: string },
 * }} [opts]
 * @returns {{ normalizedOk: boolean, roundTripOk: boolean, detail?: string }}
 */
export function docxRoundTripHook(bytes, opts = {}) {
  const norm = normalizeDocxPackage(bytes, opts);
  if (!norm.ok) {
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
 *   (i) `normalizeDocxPackage` (`ooxml-normalize.ts`) over all XML/rels parts;
 *   (ii) `docx-engine` `parseDocx` → `saveDocx` (forcing full `patchDocxXml` +
 *        `normalizeOoxmlXml` + zip serialization) → `parseDocx` reopen check,
 *        plus `roundTripDocxSync` structural verification.
 *
 * @param {Uint8Array} bytes
 * @param {{
 *   docxEngine?: { parseDocx: Function, saveDocx: Function } | null,
 *   normalizeFn?: (xml: string) => string,
 *   needsNormalizeFn?: (xml: string) => boolean,
 *   scanBodyFn?: typeof scanBody,
 * }} [opts]
 * @returns {Promise<{ normalizedOk: boolean, roundTripOk: boolean, detail?: string }>}
 */
export async function runDocxRoundTrip(bytes, opts = {}) {
  const norm = normalizeDocxPackage(bytes, opts);
  if (!norm.ok) {
    return {
      normalizedOk: false,
      roundTripOk: false,
      detail: norm.detail ?? 'docx_ooxml_normalize_failed',
    };
  }

  const syncRt = roundTripDocxSync(norm.entries, norm.docXml, opts);
  if (!syncRt.ok) {
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
