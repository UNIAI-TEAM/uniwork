// CONTRACT-v1 bridge for the DOC-003 lab: the versioned envelope every browser save in the lab
// carries, the manifest fixture binding, and the durable save receipt a Tester reads back.
//
// This module is a NEW file added by the core-protocol candidate patch; it is imported by the
// reconciled e2e/office-g0/lab-server.mjs and never by product code. It speaks
// `uniwork-office-lab-bridge@1` (see CONTRACT-v1.md beside the candidate, which is authoritative).
//
// What it does NOT do: it never invents a value. A digest is recomputed from the bytes on disk, an
// engine identity comes from a caller-supplied file generated from the prepared source's own
// package.json, an Orca version comes from the runner's own `orca --version`, and anything not
// observed is recorded as null with the reason. A refusal is written as a refusal receipt; a save
// whose receipt cannot be written is never answered ok.
//
// Node 22 built-ins only. No product imports.

import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { LabProtocolError } from './lab-storage.mjs';

/** The protocol string. A new version is a new string; this one is never edited in place. */
export const BRIDGE_CONTRACT_NAME = 'uniwork-office-lab-bridge';
export const BRIDGE_PROTOCOL_VERSION = 1;
export const BRIDGE_CONTRACT = BRIDGE_CONTRACT_NAME + '@' + BRIDGE_PROTOCOL_VERSION;
export const BRIDGE_RECEIPT_KIND = 'uniwork-office-lab-save-receipt';
export const BRIDGE_RECEIPT_SCHEMA_VERSION = 1;

/**
 * The save channels v1 covers, with the format each one saves. `text-save` serves two formats;
 * the session's app decides which one it is (`docs`/`sheets`/`slides`/`pdf` are one format each).
 */
export const BRIDGE_SAVE_CHANNELS = Object.freeze({
  'host:docs-save': { op: 'docs-save', format: 'docx' },
  'host:docs-save-new': { op: 'docs-save-new', format: 'docx' },
  'host:docs-save-as': { op: 'docs-save-as', format: 'docx' },
  'host:docs-save-to': { op: 'docs-save-to', format: 'docx' },
  'host:text-save': { op: 'text-save', format: null },
  'host:pdf-save': { op: 'pdf-save', format: 'pdf' },
  'host:sheets-save-edits': { op: 'sheets-save', format: 'xlsx' },
  'host:slides-save': { op: 'slides-save', format: 'pptx' },
  'host:slides-save-as': { op: 'slides-save-as', format: 'pptx' },
});

/** App -> format for the six G0 formats (the lab serves exactly these apps). */
export const APP_FORMAT = Object.freeze({
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
  pdf: 'pdf',
  markdown: 'md',
  html: 'html',
});

/** The canonical operation id a row for this format must use (verifier REQUIRED_OPERATION_IDS). */
export const OPERATION_ID_FOR_FORMAT = Object.freeze({
  docx: 'open-edit-text-save-reopen',
  xlsx: 'open-edit-cell-recalculate-save-reopen',
  pptx: 'edit-text-image-shape-save-reopen',
  pdf: 'replace-text-and-image-save-reopen',
  md: 'edit-source-save-reopen',
  html: 'edit-source-save-reopen-isolated-preview',
});

/** The channel that saves with this op, or null when the op is not a bridge save. */
export const bridgeChannelForOp = (op) =>
  Object.keys(BRIDGE_SAVE_CHANNELS).find((channel) => BRIDGE_SAVE_CHANNELS[channel].op === op) ?? null;

const FIXTURE_ID_SHAPE = /^F-[A-Z0-9][A-Z0-9-]*$/;
const CHANNEL_SANITIZER = /[^a-z0-9-]+/g;
const isSha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
const readBytes = (file) => fs.readFileSync(file);

export const bridgeSha256 = (data) =>
  crypto.createHash('sha256').update(Buffer.isBuffer(data) ? data : Buffer.from(data)).digest('hex');

/** canonical-json-v1: sorted keys, no insignificant whitespace, stable for digesting. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map((entry) => canonicalJson(entry)).join(',') + ']';
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

/** The receipt digest covers the receipt with digest.value set to null. */
export function receiptDigest(receipt) {
  const copy = { ...receipt, digest: { ...(receipt.digest ?? {}), value: null } };
  return bridgeSha256(canonicalJson(copy));
}

const channelFile = (channel) => String(channel).toLowerCase().replace(CHANNEL_SANITIZER, '-');
const sequenceFile = (sequence) => String(sequence).padStart(4, '0');

function writeAtomic(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = target + '.bridge-stage-' + crypto.randomUUID();
  fs.writeFileSync(staging, bytes);
  fs.renameSync(staging, target);
}

/**
 * Reads and validates a fixture manifest once, so a bad manifest is refused at boot rather than at
 * the first open. Returns { manifestPath, manifestSha256, root, entries }.
 */
export function loadFixtureManifest({ manifestPath, fixtureRoot = null }) {
  let raw;
  try {
    raw = readBytes(manifestPath);
  } catch (error) {
    throw new LabProtocolError('fixture_manifest_missing', 'cannot read fixture manifest ' + String(manifestPath) + ': ' + String(error.message ?? error), { manifestPath });
  }
  let manifest;
  try {
    manifest = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new LabProtocolError('fixture_manifest_invalid', 'fixture manifest is not valid JSON: ' + String(manifestPath), { manifestPath });
  }
  if (!manifest || !Array.isArray(manifest.fixtures)) {
    throw new LabProtocolError('fixture_manifest_invalid', 'fixture manifest has no fixtures array: ' + String(manifestPath), { manifestPath });
  }
  const entries = new Map();
  for (const entry of manifest.fixtures) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.path !== 'string' ||
        !Object.prototype.hasOwnProperty.call(entry, 'bytes') || !Object.prototype.hasOwnProperty.call(entry, 'sha256')) {
      throw new LabProtocolError('fixture_manifest_invalid', 'a manifest entry is missing id/path: ' + JSON.stringify(entry?.id ?? null), { manifestPath, entryId: entry?.id ?? null });
    }
    // A large-band or pending entry (F-DOCX-TOC, F-LARGE-DOCX, F-LARGE-XLSX) legitimately carries
    // bytes:null/sha256:null because its bytes do not ship in Git. That is not a malformed manifest -
    // it is an entry with NO fixture identity, so it loads and is refused only when someone asks for
    // it: refusing at boot would reject the repository's own valid manifest.
    const identityAvailable = Number.isInteger(entry.bytes) && entry.bytes >= 0 && isSha256(entry.sha256);
    entries.set(entry.id, {
      ...entry,
      identityAvailable,
      identityUnavailableReason: identityAvailable ? null : 'the manifest entry carries no bytes/sha256, so no fixture identity can be bound',
    });
  }
  // Entry paths are REPOSITORY-relative (`docs/docx-kitchen-sink.docx`), and their bytes live beside
  // the manifest under `files/`: this is the rule M/scripts/office-g0/paths.mjs already owns
  // (`resolveFixtureRoot` = <repo>/docs/office/g0/fixtures/files), not an assumption about depth.
  // A caller that passes --fixture-root overrides it.
  const root = fixtureRoot ?? path.join(path.dirname(path.resolve(manifestPath)), 'files');
  return { manifestPath: path.resolve(manifestPath), manifestSha256: bridgeSha256(raw), root: path.resolve(root), entries };
}

/**
 * Resolves one manifest entry inside its fixture root, or refuses. A repository-relative entry path
 * that is absolute, walks out with "..", or resolves outside the root through a link is a malformed
 * manifest entry: the fixture identity must come from inside the declared root.
 */
export function resolveFixtureEntryPath({ root, relative, fixtureId = null, manifestPath = null }) {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new LabProtocolError('fixture_manifest_invalid', 'a manifest entry path must be a non-empty string', { fixtureId, manifestPath });
  }
  if (path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
    throw new LabProtocolError('fixture_manifest_invalid', 'a manifest entry path must be repository-relative', { fixtureId, manifestPath, relative });
  }
  const resolvedRoot = path.resolve(root);
  const abs = path.resolve(resolvedRoot, relative);
  const lexical = path.relative(resolvedRoot, abs);
  if (lexical.startsWith('..') || path.isAbsolute(lexical)) {
    throw new LabProtocolError('fixture_manifest_invalid', 'manifest entry path escapes the fixture root: ' + relative, { fixtureId, manifestPath, root: resolvedRoot, resolved: abs });
  }
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return abs;
  }
  const realRel = path.relative(fs.realpathSync(resolvedRoot), real);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    throw new LabProtocolError('fixture_manifest_invalid', 'manifest entry path resolves outside the fixture root through a link: ' + relative, { fixtureId, manifestPath, root: resolvedRoot, real });
  }
  return abs;
}

/** True when an open target names a manifest fixture rather than a path. */
export function looksLikeFixtureId(target) {
  return typeof target === 'string' && FIXTURE_ID_SHAPE.test(target.trim());
}

/**
 * The bridge: fixture binding, declared-envelope validation, engine-call attribution and the
 * durable save receipt. One instance per lab server.
 */
export function createBridge({
  labDir,
  receiptsDir = null,
  manifestPath = null,
  fixtureRoot = null,
  orcaVersion = null,
  orcaVersionSource = null,
  sourcePin = null,
  sourceRoot = null,
  engineHost = null,
  engineIdentity = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!labDir) throw new Error('lab bridge: labDir is required');
  const receiptsRoot = path.resolve(receiptsDir ?? path.join(labDir, 'receipts'));
  const manifest = manifestPath ? loadFixtureManifest({ manifestPath, fixtureRoot }) : null;
  const sequences = new Map();
  const stamps = new Map();
  const engineCalls = new Map();
  const activeCalls = new Map();
  // The call token travels with the REQUEST's async context, so a concurrent request on the same view
  // can never be attributed to another request's engine call.
  const callContext = new AsyncLocalStorage();
  const callCounters = new Map();
  const requests = new Map();
  const openCalls = new Map();

  // Fail fast on an identity file that cannot be trusted: a row must never quote a name or version
  // this module could not read.
  if (engineIdentity !== null && engineIdentity !== undefined) {
    if (typeof engineIdentity !== 'object' || Array.isArray(engineIdentity)) {
      throw new Error('lab bridge: engine identity must be an object keyed by app');
    }
    for (const [app, identity] of Object.entries(engineIdentity)) {
      if (!identity || typeof identity.name !== 'string' || typeof identity.version !== 'string' ||
          !['browser-renderer', 'engine-host-http'].includes(identity.runtime)) {
        throw new Error('lab bridge: engine identity for "' + app + '" needs { name, version, runtime }');
      }
    }
  }

  const noteEngineCall = (viewId, operation) => {
    if (typeof viewId !== 'string' || viewId.length === 0) return;
    const list = engineCalls.get(viewId) ?? [];
    const scoped = callContext.getStore();
    const active = scoped && scoped.token && scoped.token.viewId === viewId ? scoped.token : activeCalls.get(viewId) ?? null;
    list.push({ operation, at: now(), channel: active ? active.channel : null, callIndex: active ? active.index : null });
    engineCalls.set(viewId, list);
  };

  /** Wraps the lab's engine proxy so every real engine call is attributed to its view and channel. */
  const trackEngine = (engine) => ({
    ...engine,
    call: async (operation, input, options = {}) => {
      noteEngineCall(options?.viewId, operation);
      return engine.call(operation, input, options);
    },
  });

  const beginCall = (viewId, channel) => {
    const index = (callCounters.get(viewId) ?? 0) + 1;
    callCounters.set(viewId, index);
    const token = { viewId, channel, index, from: (engineCalls.get(viewId) ?? []).length };
    activeCalls.set(viewId, token);
    return token;
  };
  /** Runs one /lab handler inside its own call-token context. */
  const runWithCall = (token, fn) => callContext.run({ token }, fn);
  const currentCall = (viewId) => {
    const scoped = callContext.getStore();
    if (scoped && scoped.token && scoped.token.viewId === viewId) return scoped.token;
    return activeCalls.get(viewId) ?? null;
  };
  const endCall = (viewId, token = null) => {
    const active = activeCalls.get(viewId) ?? null;
    if (!token || !active || active.index === token.index) activeCalls.delete(viewId);
  };

  /**
   * Opens the bridge context of one /lab call: validates a declared envelope BEFORE the handler
   * runs (so a refused contract never reaches a write or an engine call) and freezes the request
   * digest, the declared block and the observed user agent for the receipt.
   */
  const beginRequest = ({ session, channel, body, userAgent = null, declared = null }) => {
    const validated = validateDeclared(declared, { channel, session });
    const context = {
      channel,
      viewId: session.viewId,
      requestDigest: bridgeSha256(canonicalJson({ channel, body: body ?? {} })),
      declared: validated,
      userAgent: typeof userAgent === 'string' && userAgent.length > 0 ? userAgent : null,
    };
    requests.set(session.viewId, context);
    return context;
  };
  const requestContext = (viewId) => requests.get(viewId) ?? null;

  /**
   * The bytes the session actually copied must equal the fixture identity that was validated. The
   * adapter checks this AFTER the copy as well as before it, so a file changed between the two reads
   * cannot produce a view whose working copy disagrees with its recorded identity.
   */
  const verifyCopiedFixture = (session, fixture) => {
    if (!fixture) return null;
    const copiedSha = typeof session.sourceHash === 'string' ? session.sourceHash : null;
    const copiedBytes = Number.isInteger(session.sourceBytes) ? session.sourceBytes : null;
    if (copiedSha !== fixture.sha256 || copiedBytes !== fixture.bytes) {
      throw new LabProtocolError('fixture_identity_mismatch',
        'the opened copy is not byte-equal to manifest fixture ' + fixture.id,
        { fixtureId: fixture.id, stage: 'post-copy', expectedBytes: fixture.bytes, observedBytes: copiedBytes, expectedSha256: fixture.sha256, observedSha256: copiedSha });
    }
    return true;
  };

  /** Resolves the open target of a session: a manifest id, or a raw path. */
  const resolveOpenTarget = ({ app, target }) => {
    if (target === null || target === undefined) return { sourcePath: null, fixture: null };
    if (typeof target !== 'string') {
      throw new LabProtocolError('invalid_input', 'a session open target must be a string or null');
    }
    const trimmed = target.trim();
    const explicit = trimmed.startsWith('manifest:') ? trimmed.slice('manifest:'.length) : trimmed;
    if (!explicit.startsWith('manifest:') && !looksLikeFixtureId(explicit)) {
      return { sourcePath: target, fixture: null };
    }
    if (!manifest) {
      throw new LabProtocolError('fixture_manifest_missing', 'this lab was started without --fixture-manifest, so fixture id ' + explicit + ' cannot be resolved', { fixtureId: explicit });
    }
    const entry = manifest.entries.get(explicit) ?? null;
    if (!entry) {
      throw new LabProtocolError('fixture_not_in_manifest', 'no manifest entry ' + explicit, { fixtureId: explicit, manifestPath: manifest.manifestPath });
    }
    if (entry.identityAvailable !== true) {
      throw new LabProtocolError('fixture_identity_unavailable',
        'fixture ' + explicit + ' has no bytes/sha256 in the manifest (' + entry.identityUnavailableReason + '), so it cannot bind an identity',
        { fixtureId: explicit, manifestPath: manifest.manifestPath, reason: entry.identityUnavailableReason });
    }
    const abs = resolveFixtureEntryPath({ root: manifest.root, relative: entry.path, fixtureId: explicit, manifestPath: manifest.manifestPath });
    let bytes;
    try {
      bytes = readBytes(abs);
    } catch (error) {
      throw new LabProtocolError('fixture_bytes_missing', 'manifest fixture file is unreadable: ' + abs + ' (' + String(error.message ?? error) + ')', { fixtureId: explicit, path: abs });
    }
    const observedSha256 = bridgeSha256(bytes);
    if (bytes.length !== entry.bytes || observedSha256.toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new LabProtocolError('fixture_identity_mismatch',
        'fixture ' + explicit + ' on disk is not byte-equal to the manifest entry',
        { fixtureId: explicit, expectedBytes: entry.bytes, observedBytes: bytes.length, expectedSha256: String(entry.sha256).toLowerCase(), observedSha256 });
    }
    return {
      sourcePath: abs,
      fixture: {
        id: entry.id,
        manifestPath: manifest.manifestPath,
        manifestSha256: manifest.manifestSha256,
        path: abs,
        bytes: bytes.length,
        sha256: observedSha256,
        byteEqualToManifest: true,
      },
    };
  };

  /** Every declared bridge block must name the contract this adapter implements. */
  const validateDeclared = (declared, { channel, session }) => {
    if (declared === null || declared === undefined) return null;
    if (typeof declared !== 'object' || Array.isArray(declared)) {
      throw new LabProtocolError('invalid_input', 'a declared bridge block must be an object');
    }
    const contract = typeof declared.contract === 'string' ? declared.contract.trim() : '';
    if (contract.length === 0) {
      throw new LabProtocolError('bridge_contract_required', 'a declared bridge block must carry a contract string', { implemented: BRIDGE_CONTRACT });
    }
    if (contract !== BRIDGE_CONTRACT) {
      throw new LabProtocolError('bridge_contract_unsupported', 'this adapter implements ' + BRIDGE_CONTRACT + ', not ' + contract, { implemented: BRIDGE_CONTRACT, declared: contract });
    }
    const saveChannel = BRIDGE_SAVE_CHANNELS[channel] ?? null;
    if (saveChannel && declared.operationId !== undefined && declared.operationId !== null) {
      const format = saveChannel.format ?? APP_FORMAT[session?.app] ?? null;
      const canonical = format ? OPERATION_ID_FOR_FORMAT[format] : null;
      if (canonical && declared.operationId !== canonical) {
        throw new LabProtocolError('bridge_operation_mismatch', 'declared operationId is not canonical for ' + String(format), { declared: declared.operationId, canonical });
      }
    }
    return declared;
  };

  const appendIndex = (viewId, entry) => {
    const file = path.join(receiptsRoot, viewId, 'index.json');
    let index = { viewId, entries: [] };
    try {
      index = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(index.entries)) index = { viewId, entries: [] };
    } catch {
      index = { viewId, entries: [] };
    }
    index.entries.push(entry);
    writeAtomic(file, Buffer.from(JSON.stringify(index, null, 2) + '\n'));
    return index;
  };
  // The next sequence continues the view's EXISTING receipts, so a bridge recreated for the same
  // lab (a restart, a second server) can never overwrite a receipt or restart the index at 0001.
  const nextSequence = (viewId) => {
    if (!sequences.has(viewId)) {
      let highest = 0;
      try {
        for (const name of fs.readdirSync(path.join(receiptsRoot, viewId))) {
          const match = /^(?:save|refused)-(\d{4})-/.exec(name);
          if (match) highest = Math.max(highest, Number(match[1]));
        }
      } catch {
        highest = 0;
      }
      sequences.set(viewId, highest);
    }
    const next = sequences.get(viewId) + 1;
    sequences.set(viewId, next);
    return next;
  };

  const inputBlock = (session, fixture) => {
    if (fixture) {
      return {
        fixtureId: fixture.id,
        manifestPath: fixture.manifestPath,
        manifestSha256: fixture.manifestSha256,
        path: fixture.path,
        name: path.basename(fixture.path),
        bytes: fixture.bytes,
        sha256: fixture.sha256,
        byteEqualToManifest: true,
      };
    }
    return {
      fixtureId: null,
      manifestPath: null,
      manifestSha256: null,
      path: session.sourceReal ?? session.sourcePath ?? null,
      name: session.sourceName ?? (session.sourceReal ? path.basename(session.sourceReal) : null),
      bytes: Number.isInteger(session.sourceBytes) ? session.sourceBytes : null,
      sha256: typeof session.sourceHash === 'string' ? session.sourceHash : null,
      byteEqualToManifest: null,
    };
  };

  const browserBlock = (declared, userAgent) => {
    const ua = typeof userAgent === 'string' && userAgent.length > 0 ? userAgent : null;
    const match = ua ? /Chrome\/([0-9]+(?:\.[0-9]+)*)/.exec(ua) : null;
    const declaredClient = declared && typeof declared === 'object' && declared.client && typeof declared.client === 'object' ? declared.client : null;
    const declaredUserAgent = declaredClient && typeof declaredClient.userAgent === 'string' ? declaredClient.userAgent : null;
    const declaredFamily = declaredClient && typeof declaredClient.family === 'string' && declaredClient.family.length > 0 ? declaredClient.family : null;
    const observedOrca = typeof orcaVersion === 'string' && orcaVersion.length > 0;
    // An Orca claim has to be carried by the transport: a declared orca client, or a Chrome-shaped
    // user agent from a run whose runner also observed `orca --version`. A scripted HTTP client that
    // sends a browser-shaped UA without that observation is recorded as unspecified, not as a browser.
    const family = declaredFamily === 'orca' || (match !== null && observedOrca) ? 'orca' : (declaredFamily ?? 'unspecified');
    return {
      family,
      familySource: family !== 'orca'
        ? 'unspecified - no declared orca client and no browser-shaped user agent with an observed Orca version'
        : declaredFamily === 'orca' ? 'declared-client' : 'user-agent + runner-observed orca version',
      orcaVersion: observedOrca ? orcaVersion : null,
      orcaVersionSource: observedOrca ? (orcaVersionSource ?? 'caller-provided') : 'unavailable',
      userAgent: ua,
      chromiumVersion: match ? match[1] : null,
      declared: declaredClient,
      declaredMatchesUserAgent: declaredUserAgent !== null && ua !== null ? declaredUserAgent === ua : null,
    };
  };

  const engineBlock = (session, operations, sessionOperations) => {
    if (!engineIdentity) return null;
    const identity = engineIdentity[session.app] ?? null;
    if (!identity) return null;
    return {
      name: identity.name,
      version: identity.version,
      runtime: identity.runtime,
      // The engine-host URL this save really called, or null: an in-process (injected) handler and a
      // save that performed no engine call at all both report null, never a configured-but-unused URL.
      host: operations.length > 0 ? (engineHost ?? identity.host ?? null) : null,
      operations: operations.map((entry) => entry.operation),
      sessionOperations: sessionOperations.map((entry) => entry.operation),
      sourcePin: sourcePin ?? null,
      source: sourceRoot ?? null,
    };
  };

  const buildReceipt = ({ ok, session, channel, fixture, output, declared, userAgent, requestDigest, operations, sessionOperations, refusal, sequence }) => {
    const entry = BRIDGE_SAVE_CHANNELS[channel];
    const format = entry?.format ?? APP_FORMAT[session.app] ?? null;
    const head = {
      kind: BRIDGE_RECEIPT_KIND,
      schemaVersion: BRIDGE_RECEIPT_SCHEMA_VERSION,
      ok,
      contract: BRIDGE_CONTRACT,
      protocol: { name: BRIDGE_CONTRACT_NAME, version: BRIDGE_PROTOCOL_VERSION },
      at: now(),
      sequence,
      viewId: session.viewId,
      app: session.app,
      format,
      channel,
      op: entry?.op ?? null,
      operationId: format ? OPERATION_ID_FOR_FORMAT[format] ?? null : null,
      labRoot: path.resolve(labDir),
      requestDigest: requestDigest ?? null,
      ...(ok ? {} : { refusal: refusal ?? { code: 'invalid_input', message: 'no refusal recorded', details: null } }),
    };
    const body = {
      receipt: head,
      input: inputBlock(session, fixture ?? session.bridgeFixture ?? null),
      ...(ok && output ? { output } : {}),
      engine: engineBlock(session, operations, sessionOperations),
      browser: browserBlock(declared, userAgent),
      digest: { algorithm: 'sha256', canonicalization: 'canonical-json-v1 (sorted keys, no whitespace, digest.value=null)', value: null },
    };
    body.digest.value = receiptDigest(body);
    return body;
  };

  const writeReceipt = ({ receipt, kindFile }) => {
    const sequence = receipt.receipt.sequence;
    const file = path.join(receiptsRoot, receipt.receipt.viewId, kindFile + '-' + sequenceFile(sequence) + '-' + channelFile(receipt.receipt.channel) + '.json');
    // A receipt is never overwritten: an existing file at this name means the sequence collided.
    if (fs.existsSync(file)) {
      throw new LabProtocolError('bridge_receipt_unwritable', 'a receipt already exists at ' + file, { path: file });
    }
    try {
      writeAtomic(file, Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
      appendIndex(receipt.receipt.viewId, {
        sequence, kind: kindFile, channel: receipt.receipt.channel, format: receipt.receipt.format,
        operationId: receipt.receipt.operationId, at: receipt.receipt.at, receiptPath: file,
        ...(receipt.receipt.ok ? { outputSha256: receipt.output?.sha256 ?? null, bytes: receipt.output?.bytes ?? null } : { code: receipt.receipt.refusal?.code ?? null }),
      });
    } catch (error) {
      throw new LabProtocolError('bridge_receipt_unwritable', 'could not write the save receipt ' + file + ': ' + String(error.message ?? error), { path: file });
    }
    return file;
  };

  /**
   * Records one save. The output digest is ALWAYS recomputed from the bytes on disk; a declared
   * digest that disagrees is refused (`output_hash_mismatch`), and only a refusal receipt is kept.
   * A save is never recorded before its receipt exists.
   */
  const recordSave = ({ channel, session, requestDigest = null, declared = null, userAgent = null, output, onlyIfTracked = true }) => {
    const entry = BRIDGE_SAVE_CHANNELS[channel] ?? null;
    if (!entry || (onlyIfTracked && !entry)) return null;
    const sequence = nextSequence(session.viewId);
    const sessionOperations = (engineCalls.get(session.viewId) ?? []).slice();
    // Only the operations of THIS /lab call: the call token is what binds a call to its request, so a
    // second save on the same channel can never inherit the first save's engine operations.
    const active = currentCall(session.viewId);
    const operations = active
      ? sessionOperations.filter((call) => call.callIndex === active.index)
      : sessionOperations.filter((call) => call.channel === channel && call.callIndex === null);
    const fixture = session.bridgeFixture ?? null;
    let observedSha256 = null;
    let observedBytes = null;
    if (output && typeof output.path === 'string') {
      try {
        const bytes = readBytes(output.path);
        observedBytes = bytes.length;
        observedSha256 = bridgeSha256(bytes);
      } catch (error) {
        const refusal = { code: 'read_failed', message: 'could not read the saved bytes back from disk', details: { path: output.path, error: String(error.message ?? error) } };
        const receipt = buildReceipt({ ok: false, session, channel, fixture, declared, userAgent, requestDigest, operations, sessionOperations, refusal, sequence });
        const file = writeReceipt({ receipt, kindFile: 'refused' });
        throw new LabProtocolError('read_failed', refusal.message, { ...refusal.details, receiptPath: file });
      }
    }
    const declaredSha256 = output && typeof output.declaredSha256 === 'string' ? output.declaredSha256.toLowerCase() : null;
    const bytesMatch = output ? output.bytesMatch !== false : true;
    const mismatch = (declaredSha256 !== null && declaredSha256 !== observedSha256) || !bytesMatch;
    if (mismatch) {
      const refusal = {
        code: 'output_hash_mismatch',
        message: 'the declared output does not match the bytes on disk',
        details: {
          path: output?.path ?? null,
          declaredSha256,
          observedSha256,
          declaredBytes: Number.isInteger(output?.declaredBytes) ? output.declaredBytes : null,
          observedBytes,
          bytesMatch,
        },
      };
      const receipt = buildReceipt({ ok: false, session, channel, fixture, declared, userAgent, requestDigest, operations, sessionOperations, refusal, sequence });
      const file = writeReceipt({ receipt, kindFile: 'refused' });
      throw new LabProtocolError('output_hash_mismatch', refusal.message, { ...refusal.details, receiptPath: file });
    }
    const outputBlock = {
      path: output?.path ?? null,
      name: output?.path ? path.basename(output.path) : null,
      bytes: observedBytes,
      sha256: observedSha256,
      // Null means "the writer/engine declared nothing": the adapter never fills this with its own
      // recomputation, so a reader can tell a second opinion from a restatement.
      declaredSha256,
      declaredIndependently: declaredSha256 !== null,
      independentDeclaration: declaredSha256 === null ? 'not-declared' : 'matched',
      verified: true,
      verifiedAgainst: 'bytes read back from disk; output.sha256 is the adapter recomputation',
    };
    const receipt = buildReceipt({ ok: true, session, channel, fixture, output: outputBlock, declared, userAgent, requestDigest, operations, sessionOperations, sequence });
    const file = writeReceipt({ receipt, kindFile: 'save' });
    const stamp = {
      contract: BRIDGE_CONTRACT,
      protocol: { name: BRIDGE_CONTRACT_NAME, version: BRIDGE_PROTOCOL_VERSION },
      operationId: receipt.receipt.operationId,
      requestDigest,
      outputSha256: observedSha256,
      outputBytes: observedBytes,
      receiptPath: file,
      receiptDigest: receipt.digest.value,
    };
    stamps.set(session.viewId + '|' + channel, stamp);
    // The durable receipt and the live operation log agree; a Tester can cross-check one with the
    // other without trusting either alone.
    return { stamp, receipt };
  };

  /** Adds the bridge stamp to a successful save result (never to a refusal). */
  const stampResult = (channel, result, session) => {
    const entry = BRIDGE_SAVE_CHANNELS[channel] ?? null;
    if (!entry || !result || typeof result !== 'object') return result;
    const stamp = stamps.get(session.viewId + '|' + channel) ?? null;
    if (!stamp) return result;
    if (result.ok === false || result.status === 'error') return result;
    return Object.assign({}, result, { bridge: stamp });
  };

  return {
    contract: BRIDGE_CONTRACT,
    receiptsRoot,
    manifest,
    /** Boot-time facts for the lab's own log line, so "unbound" is visible rather than assumed. */
    status: () => ({
      contract: BRIDGE_CONTRACT,
      receiptsRoot,
      manifestPath: manifest ? manifest.manifestPath : null,
      manifestSha256: manifest ? manifest.manifestSha256 : null,
      manifestFixtures: manifest ? manifest.entries.size : 0,
      orcaVersion: typeof orcaVersion === 'string' && orcaVersion.length > 0 ? orcaVersion : null,
      orcaVersionSource: orcaVersionSource ?? 'unavailable',
      engineIdentity: engineIdentity ? Object.keys(engineIdentity).sort() : null,
      sourcePin: sourcePin ?? null,
    }),
    beginRequest,
    requestContext,
        resolveOpenTarget,
    verifyCopiedFixture,
    validateDeclared,
    trackEngine,
    beginCall,
    endCall,
    runWithCall,
    currentCall,
    recordSave,
    stampResult,
    noteEngineCall,
    receiptsFor: (viewId) => (engineCalls.get(viewId) ?? []).slice(),
    readIndex(viewId) {
      const file = path.join(receiptsRoot, viewId, 'index.json');
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return { viewId, entries: [] };
      }
    },
    /** The Tester's read-back: every receipt file of a view, oldest first. */
    receiptsOnDisk(viewId) {
      const dir = path.join(receiptsRoot, viewId);
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch {
        return [];
      }
      return names
        .filter((name) => /^(save|refused)-[0-9]{4}-.*\.json$/.test(name))
        .sort()
        .map((name) => ({ name, path: path.join(dir, name), receipt: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) }));
    },
    /** Used by the server to attach the resolved manifest fixture to a session. */
    attachFixture: (session, fixture) => {
      session.bridgeFixture = fixture;
      return session;
    },
  };
}

/**
 * The engine identity file the runner passes as --engine-identity: { "<app>": { name, version,
 * runtime } }. `runtime` is `engine-host-http` when the save path calls the engine host and
 * `browser-renderer` when the bytes were produced inside the renderer bundle.
 */
export function readEngineIdentity(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('engine identity file must be an object keyed by app: ' + String(file));
  }
  return raw;
}
