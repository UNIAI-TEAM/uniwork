// DOC-003 lab server (UNI-667): the file/session/preview/engine transport for
// the six GenOffice renderers, on loopback only.
//
//   node e2e/office-g0/lab-server.mjs --builds <dir> --lab <dir> [--port 5390]
//        [--preview-port 5391] [--engine http://127.0.0.1:5392]
//        [--fixtures <dir>] [--timeout-ms 15000]
//
// This is not a product service and proves nothing about production auth,
// tenancy or permissions. What it does guarantee, for the lab:
//
//   * loopback only, and every API request is checked for an allowed Host, a
//     JSON content type and (when supplied) a trusted Origin. `Origin: null`
//     from the opaque preview sandbox is refused, so the previewed document
//     cannot call the app API.
//   * no permissive CORS: the lab never answers with an
//     Access-Control-Allow-Origin header, so no third-party origin can read a
//     lab response by script.
//   * the viewer identity is server-minted. `lab:session-open` creates the view
//     and its grants; a caller cannot name a view id or a destination, and an
//     unknown or forged view id is rejected before any handler runs.
//   * reads are realpath-contained and write targets must be granted to the
//     calling view, so fixtures, the prepared source and the renderer builds can
//     never be written.
//   * a channel or verb with no implementation fails by name
//     (`unknown_channel`, `engine_unsupported`). Nothing returns a fabricated
//     success, and no engine failure is ever turned into an empty save.
//   * the renderer builds are served with their own CSP preserved; nothing is
//     injected into them and no `window.*Api` global is created.
//
// Import-safe: importing this module only defines exports. Listening happens in
// `main()`, which runs only when the file is executed directly.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { EngineUnsupportedError, assertNonEmptyBytes, byteFormatFor, createEngineProxy, decodeBase64Strict } from './lab-engine.mjs';
import { LabEventBus } from './lab-events.mjs';
import {
  PreviewBuffers,
  appCsp,
  buildPreviewDocument,
  createPreviewResponder,
  mimeFor,
  previewTokenBase,
  translateHtmlPreviewFrameSrc,
} from './lab-preview.mjs';
import {
  LabProtocolError,
  LabRoots,
  ViewSessions,
  assetRelativeSegments,
  isContainedWithin,
  readFileBytes,
  realPathFor,
  sanitizeName,
  sha256,
  withExtension,
  writeFileAtomic,
} from './lab-storage.mjs';
import { discoverHtmlImageSources, mergeImageSources } from './lab-html-sources.mjs';
import { discoverHtmlStylesheets } from './lab-html-stylesheets.mjs';
import { discoverMarkdownSources } from './lab-markdown-sources.mjs';
import { BRIDGE_SAVE_CHANNELS, bridgeChannelForOp, createBridge, readEngineIdentity } from './lab-bridge.mjs';
import { createPageImagePngHandler, createPagePreviewPngHandler, PageImagePngError } from './lab-page-image-png.mjs';

export const LAB_APPS = ['docs', 'markdown', 'html', 'pdf', 'sheets', 'slides'];
export const DEFAULT_PORT = 5390;
export const DEFAULT_MAX_BODY_BYTES = 48 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15000;

/** HTTP status per error code, so a caller can tell a protocol error from a crash. */
const STATUS_BY_CODE = {
  origin_rejected: 403,
  host_rejected: 403,
  unsupported_media_type: 415,
  method_not_allowed: 405,
  unknown_channel: 404,
  unknown_view: 404,
  unknown_app: 404,
  unknown_preview: 404,
  path_not_found: 404,
  not_a_file: 400,
  path_required: 400,
  invalid_json: 400,
  invalid_input: 400,
  invalid_base64: 400,
  payload_too_large: 413,
  path_outside_lab: 403,
  write_root_forbidden: 403,
  path_not_granted: 403,
  write_not_granted: 403,
  wrong_view: 403,
  empty_output_refused: 422,
  save_conflict: 409,
  engine_unsupported: 501,
  unknown_engine_operation: 501,
  engine_timeout: 504,
  engine_unreachable: 502,
  engine_http_error: 502,
  engine_invalid_response: 502,
  engine_response_too_large: 502,
  engine_error: 502,
  read_failed: 500,
  write_failed: 500,
  html_preview_csp_missing: 500,
  html_preview_csp_ambiguous: 500,
  html_preview_csp_unsupported: 500,
  // CONTRACT-v1 refusals carry their own status so a caller can tell a protocol refusal from a
  // crash: see CONTRACT-v1.md section 4 and section 10.
  fixture_manifest_missing: 500,
  fixture_manifest_invalid: 500,
  fixture_not_in_manifest: 400,
  fixture_identity_unavailable: 400,
  fixture_bytes_missing: 500,
  fixture_identity_mismatch: 409,
  bridge_contract_required: 400,
  bridge_contract_unsupported: 400,
  bridge_operation_mismatch: 400,
  output_hash_mismatch: 500,
  bridge_receipt_unwritable: 500,
};

export const statusForCode = (code) => STATUS_BY_CODE[code] ?? 500;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** Parses the CLI flags; exported so tests can assert the defaults. */
export function parseArgv(argv, env = process.env) {
  const argOf = (name, fallback) => {
    const index = argv.indexOf('--' + name);
    return index === -1 ? fallback : argv[index + 1];
  };
  const port = Number(argOf('port', env.LAB_PORT ?? DEFAULT_PORT));
  return {
    port,
    previewPort: Number(argOf('preview-port', env.LAB_PREVIEW_PORT ?? port + 1)),
    buildsDir: resolve(argOf('builds', env.LAB_BUILDS ?? 'lab/builds')),
    labDir: resolve(argOf('lab', env.LAB_DIR ?? 'lab')),
    fixturesDir: argOf('fixtures', env.LAB_FIXTURES ?? null),
    sourceDir: argOf('source', env.LAB_SOURCE ?? null),
    engineBaseUrl: argOf('engine', env.LAB_ENGINE ?? null),
    timeoutMs: Number(argOf('timeout-ms', env.LAB_ENGINE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)),
    maxBodyBytes: Number(argOf('max-body-bytes', env.LAB_MAX_BODY_BYTES ?? DEFAULT_MAX_BODY_BYTES)),
    // CONTRACT-v1 (uniwork-office-lab-bridge@1). Every one of these is recorded in the receipt and
    // in the boot log; nothing is inferred. --fixture-manifest binds the manifest fixture identity,
    // --engine-identity carries the prepared source's own package name/version per app,
    // --orca-version is the value the runner observed from `orca --version`.
    fixtureManifest: argOf('fixture-manifest', env.LAB_FIXTURE_MANIFEST ?? null),
    fixtureRoot: argOf('fixture-root', env.LAB_FIXTURE_ROOT ?? null),
    bridgeReceipts: argOf('bridge-receipts', env.LAB_BRIDGE_RECEIPTS ?? null),
    orcaVersion: argOf('orca-version', env.LAB_ORCA_VERSION ?? null),
    orcaVersionSource: argOf('orca-version-source', env.LAB_ORCA_VERSION_SOURCE ?? null),
    sourcePin: argOf('source-pin', env.LAB_SOURCE_PIN ?? null),
    engineIdentity: argOf('engine-identity', env.LAB_ENGINE_IDENTITY ?? null),
  };
}

/** Reads a request body with a hard byte cap; never trusts Content-Length. */
export async function readBoundedBody(req, maxBodyBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new LabProtocolError(
        'payload_too_large',
        'request body exceeds the ' + maxBodyBytes + '-byte lab cap',
        { bytes: total, maxBodyBytes },
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const isJsonContentType = (value) =>
  typeof value === 'string' && /^\s*application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(value);

/**
 * Origin policy. An absent Origin is a same-origin browser fetch (the lab pages
 * are served from this same loopback origin) and is allowed. A present Origin
 * must be one of the lab's own origins: `null` (the opaque sandbox of the HTML
 * preview, or a sandboxed frame) is refused, and any other origin is refused
 * instead of being answered with a permissive CORS header.
 */
export function checkOrigin(origin, allowedOrigins) {
  if (origin === undefined || origin === null) return;
  if (origin === '' || origin === 'null') {
    throw new LabProtocolError(
      'origin_rejected',
      'opaque origins cannot call the lab API (Origin: ' + origin + ')',
      { origin },
    );
  }
  if (!allowedOrigins.has(origin)) {
    throw new LabProtocolError(
      'origin_rejected',
      'untrusted origin ' + origin + ' cannot call the lab API',
      { origin },
    );
  }
}

/** Host pinning: the lab answers only for its own loopback host and port. */
export function checkHost(hostHeader, allowedHosts) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) {
    throw new LabProtocolError('host_rejected', 'a Host header is required');
  }
  if (!allowedHosts.has(hostHeader)) {
    throw new LabProtocolError('host_rejected', 'unexpected Host: ' + hostHeader, { host: hostHeader });
  }
}

/** Apps whose document is a serialized text buffer rather than a binary format. */
export const TEXT_APPS = Object.freeze(['markdown', 'html']);

/**
 * Channels with no single owning document app: the lab control plane, the shared
 * close report surface and the event poll. Their authority is the server-minted
 * view id, never the channel name.
 */
export const SHARED_CHANNELS = Object.freeze([
  'lab:session-open',
  'lab:session-close',
  'lab:events-poll',
  'lab:events-wait',
  'lab:events-record',
  'host:close-check',
  'host:view-menu-state',
  'host:dirty',
  // The pinned sheets renderer feeds the main-process close guard on every edit
  // (App.tsx:505-507 -> desktopApi.notifyPendingEdits -> preload IPC send), so the report
  // outlives no single document app: its authority is the server-minted view id, exactly like
  // host:dirty, and a forged view id is refused by the same view resolution.
  'host:pending-edits',
]);

/**
 * Channel family -> the apps allowed to run it. `host:text-*` and `host:image-*`
 * are the markdown/html editors' own buffer and asset surface, so they are bound
 * to those two apps rather than to an app called "text".
 */
export const CHANNEL_APP_GROUPS = Object.freeze([
  { family: /^host:text-/, apps: TEXT_APPS },
  { family: /^host:image-/, apps: TEXT_APPS },
  { family: /^host:docs-/, apps: ['docs'] },
  { family: /^host:html-/, apps: ['html'] },
  { family: /^host:pdf-/, apps: ['pdf'] },
  // getUsername is declared only by the pdf host surface (host-surface.mjs pdfApi), so the
  // channel is pdf-scoped like the rest of the pdf family rather than inheriting the
  // unrestricted authority of a shared or unowned channel.
  { family: /^host:username$/, apps: ['pdf'] },
  // slides-main.ts receives this fire-and-forget renderer preference through
  // ipcMain.on('slides:autosave-pref', ...). Keep the lab spelling used by the
  // adapter, but do not leave it unrestricted just because it lacks the
  // host:slides- prefix.
  { family: /^host:autosave-pref$/, apps: ['slides'] },
  { family: /^host:sheets-/, apps: ['sheets'] },
  { family: /^host:slides-/, apps: ['slides'] },
]);

/** The apps allowed to run a channel, or null for a shared or control channel. */
export function allowedAppsFor(channel) {
  if (SHARED_CHANNELS.includes(channel)) return null;
  const group = CHANNEL_APP_GROUPS.find((entry) => entry.family.test(channel));
  return group ? group.apps : null;
}

/**
 * Refuses a channel the calling session's app does not own, before the handler
 * runs. A docs view may not post `host:text-save` and overwrite its working
 * `.docx` with UTF-8 text; the refusal happens before any engine call, queue
 * change or write. Module scope keeps it inside the one view resolution every
 * caller goes through, so no handler option can skip it.
 */
export function assertChannelApp(channel, session) {
  const apps = allowedAppsFor(channel);
  if (!apps || apps.includes(session.app)) return;
  throw new LabProtocolError(
    'wrong_view',
    'channel ' + channel + ' belongs to app ' + apps.join('/') + ', not ' + session.app +
      ' (view ' + session.viewId + ')',
    { channel, app: session.app, allowedApps: apps },
  );
}

/**
 * The image extensions the native picture dialog offers (slides-main.ts:2295).
 * A pick outside this list is refused by name, so the lab picker cannot hand the
 * engine something the real chooser would never return.
 */
export const PICKABLE_PICTURE_EXTS = Object.freeze([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff',
]);

/** The ImageData mime for a local image file, or null when it is not an image. */
function imageMimeFor(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  return null;
}

const loopbackOrigin = (port) => 'http://127.0.0.1:' + port;

/**
 * Builds the lab. Everything the routes need is injected, including the engine
 * operation bindings, so the renderer/engine channel maps can be bound without
 * touching a route.
 */
export function createLabServer({
  buildsDir,
  labDir,
  fixturesDir = null,
  sourceDir = null,
  // The deterministic stand-in for the renderer's native picture dialog
  // (slides-main.ts:2288-2305 `slides:pick-picture-file`). The lab has no OS file
  // chooser, so the lab operator names the one image a pick would return; the
  // channel then performs a REAL read-granted file read of those bytes. It is never
  // a fabricated ImageData and never a rewritten path: with no configured pick path
  // the channel answers the documented cancel (`null`), which the renderer treats as
  // a no-op, so an unarmed picker can never look like a successful replacement.
  picturePickPath = null,
  port = DEFAULT_PORT,
  previewPort = port + 1,
  engineBaseUrl = null,
  engineHandlers = {},
  engineTimeoutMs = DEFAULT_TIMEOUT_MS,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  fixtureManifest = null,
  fixtureRoot = null,
  bridgeReceipts = null,
  orcaVersion = null,
  orcaVersionSource = null,
  sourcePin = null,
  sourceRoot = null,
  engineIdentity = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!buildsDir || !labDir) throw new Error('lab server: buildsDir and labDir are required');

  const roots = new LabRoots({ labDir, buildsDir, fixturesDir, sourceDir }).ensureSync();
  const sessions = new ViewSessions({ roots, apps: LAB_APPS });
  const previews = new PreviewBuffers();
  const events = new LabEventBus();
  const records = [];
  const record = (entry) => {
    records.push(Object.assign({ at: now() }, entry));
    if (records.length > 10000) records.shift();
  };

  // CONTRACT-v1: the bridge owns the fixture binding, the declared-envelope check, the engine-call
  // attribution and the durable save receipt. It is created before the engine proxy so the proxy
  // can be wrapped: a tracked call is the only way a receipt can name a real engine operation.
  const bridge = createBridge({
    labDir,
    receiptsDir: bridgeReceipts,
    manifestPath: fixtureManifest,
    fixtureRoot,
    orcaVersion,
    orcaVersionSource,
    sourcePin,
    sourceRoot: sourceRoot ?? sourceDir,
    engineHost: engineBaseUrl,
    engineIdentity: engineIdentity === null ? null : readEngineIdentity(engineIdentity),
    now,
  });
  const engine = bridge.trackEngine(createEngineProxy({
    baseUrl: engineBaseUrl,
    timeoutMs: engineTimeoutMs,
    fetchImpl: engineHandlers.fetchImpl ?? null,
    handlers: engineHandlers.handlers ?? engineHandlers,
  }));

  const appOrigin = loopbackOrigin(port);
  const previewOrigin = loopbackOrigin(previewPort);
  // Only the app origin may call the lab API. The preview origin is a separate,
  // sandboxed surface the app frame may embed, not an API caller: allowing it
  // let a top-level preview document POST a save. `Origin: null` from the opaque
  // sandbox stays refused by checkOrigin.
  const allowedOrigins = new Set([appOrigin]);
  const allowedHosts = new Set([
    '127.0.0.1:' + port,
    'localhost:' + port,
    '127.0.0.1:' + previewPort,
    'localhost:' + previewPort,
  ]);

  const services = { roots, sessions, previews, events, engine, records, record };
  const ctxOf = (session) => ({ session, viewId: session.viewId, app: session.app, services });
  const controlCtx = { session: null, viewId: null, app: null, services };

  /** A granted read target for this view, or a named error. */
  const readGranted = (session, target) => sessions.requireReadGrant(session.viewId, target);

  const entryOf = async (realPath) => {
    const bytes = await readFileBytes(realPath);
    return {
      path: realPath,
      name: basename(realPath),
      dataBase64: bytes.toString('base64'),
      hash: sha256(bytes),
      size: bytes.length,
    };
  };

  /** Writes bytes for a view and reports the bytes/checksum actually on disk. */
  const writeForView = async (session, target, bytes, op) => {
    const real = sessions.requireWriteGrant(session.viewId, target);
    assertNonEmptyBytes(bytes, real);
    const written = await writeFileAtomic(real, bytes);
    const onDisk = await readFileBytes(real);
    const result = {
      ok: true,
      path: real,
      bytes: onDisk.length,
      sha256: sha256(onDisk),
      bytesMatch: onDisk.length === bytes.length && written.sha256 === sha256(onDisk),
    };
    session.output = { path: real, bytes: result.bytes, sha256: result.sha256, at: now() };
    // CONTRACT-v1: a save on a bridge channel writes its durable receipt BEFORE the save is recorded
    // or answered, so the live operation log and the durable receipt carry the same bridge stamp. A
    // digest that does not match the bytes on disk, or a write whose bytes did not survive the round
    // trip, is refused here and never reported as a save.
    const bridgeChannel = bridgeChannelForOp(op);
    let bridgeStamp = null;
    if (bridgeChannel) {
      const context = bridge.requestContext(session.viewId);
      const declared = context && context.declared ? { contract: context.declared.contract, client: context.declared.client } : null;
      const recorded = bridge.recordSave({
        channel: bridgeChannel,
        session,
        requestDigest: context ? context.requestDigest : null,
        declared,
        userAgent: context ? context.userAgent : null,
        output: { path: real, bytesMatch: result.bytesMatch === true, declaredBytes: bytes.length },
      });
      if (recorded) {
        bridgeStamp = recorded.stamp;
        result.bridge = recorded.stamp;
      }
    }
    record({ view: session.viewId, op, path: real, bytes: result.bytes, sha256: result.sha256, bridge: bridgeStamp });
    events.emit(session.viewId, 'saved', { op, path: real, bytes: result.bytes, sha256: result.sha256, bridge: bridgeStamp });
    return result;
  };

  /**
   * Copies each referenced relative image beside the saved output so a fresh
   * session that reopens the output still resolves it through its own directory
   * grant. Minimal policy: only a relative path that resolves, realpath-contained,
   * inside the document's own directory is copied. Schemes, absolute paths, `..`,
   * junctions and unreadable sources are reported as skipped, never copied from an
   * arbitrary location, and the document save itself is never failed by an asset.
   */
  const preserveRelativeAssets = async (session, savedPath, imageSources, stylesheets = []) => {
    const preserved = [];
    const skipped = [];
    if (!Array.isArray(imageSources)) return { preserved, skipped };
    const base = session.sourceDir ?? session.workingDir;
    const outDir = dirname(savedPath);
    for (const source of mergeImageSources(imageSources, stylesheets)) {
      if (typeof source !== 'string' || source.length === 0) continue;
      let segments;
      try {
        const assetPath = stylesheets.includes(source) ? source.split(/[?#]/, 1)[0] : source;
        segments = assetRelativeSegments(assetPath);
      } catch (error) {
        skipped.push({ source, reason: error instanceof LabProtocolError ? error.code : 'invalid_path' });
        continue;
      }
      let realSource;
      try {
        realSource = readGranted(session, join(base, ...segments));
      } catch (error) {
        skipped.push({ source, reason: error instanceof LabProtocolError ? error.code : 'read_failed' });
        continue;
      }
      if (!isContainedWithin(base, realSource)) {
        skipped.push({ source, reason: 'outside_source_dir' });
        continue;
      }
      const target = join(outDir, ...segments);
      if (!isContainedWithin(outDir, target)) {
        skipped.push({ source, reason: 'outside_output_dir' });
        continue;
      }
      if (realPathFor(target) === realSource) {
        preserved.push({ source, path: target, copied: false });
        continue;
      }
      // HTML may copy an authored stylesheet. Markdown may copy an inert .txt.
      // Other apps stay image-only.
      const stylesheet = session.app === 'html' && stylesheets.includes(source) && extname(realSource).toLowerCase() === '.css';
      const inertText = session.app === 'markdown' && extname(realSource).toLowerCase() === '.txt';
      if (!imageMimeFor(realSource) && !stylesheet && !inertText) {
        skipped.push({ source, reason: 'not_an_image' });
        continue;
      }
      // Text is already committed; an asset failure is reported as skipped.
      try {
        const bytes = await readFileBytes(realSource);
        const written = await writeFileAtomic(sessions.requireWriteGrant(session.viewId, target), bytes);
        record({ view: session.viewId, op: 'text-save-asset', path: written.path, bytes: written.bytes, sha256:
        written.sha256 });
        preserved.push({ source, path: written.path, bytes: written.bytes, sha256: written.sha256, copied: true });
      } catch (error) {
        skipped.push({ source, reason: error.code || 'write_failed' });
      }
    }
    return { preserved, skipped };
  };

  /** A destination the server chose, inside the view's own output root. */
  const outputTargetFor = (session, name) => sessions.defaultTarget(session, name);

  /** The engine call for a view, with the identity supplied by the server. */
  const engineCall = (session, operation, input) =>
    engine.call(operation, input, { viewId: session.viewId });

  /** Drops lab transport fields before a request is forwarded to the engine. */
  function stripLabFields(body) {
    const out = {};
    for (const key of Object.keys(body ?? {})) {
      if (key === 'viewId') continue;
      out[key] = body[key];
    }
    return out;
  }

  /**
   * Records the deck identity ONLY when the engine answers for this server-minted
   * view. A mismatched identity is refused before any deck is bound, so no later
   * publication can be adopted from another view's output.
   */
  const engineCallTracked = async (session, operation, input) => {
    const answer = await engineCall(session, operation, input);
    const answered = answer && typeof answer === 'object' && typeof answer.viewId === 'string'
      ? answer.viewId
      : null;
    if (answered === null) {
      throw new LabProtocolError('engine_invalid_response', operation + ' answered without a view identity');
    }
    if (answered !== session.viewId) {
      throw new LabProtocolError('wrong_view',
        operation + ' answered for view ' + answered + ', not this view ' + session.viewId);
    }
    // nativeOutDir is the r5 native output dir of THIS server-minted view.
    session.pptx = { engineViewId: answered, nativeOutDir: session.nativeOutDir };
    return answer;
  };

  /**
   * The ONE publication path: state/records/events change only after a proven
   * non-empty publication read back from disk. The proof uses the server-minted
   * ctx.viewId, never the engine-answered identity, so a forged answer cannot
   * widen the authority.
   */
  const publishDeck = async (ctx, name, selectOutput) => {
    const sync = ctx.session.pptx;
    if (!sync) throw new LabProtocolError('invalid_input', 'slides save needs an open deck for this view');
    const result = await engineCall(ctx.session, 'pptx-save', { name, viewId: ctx.viewId });
    if (!result || typeof result !== 'object') {
      throw new LabProtocolError('engine_invalid_response', 'pptx-save returned no result object');
    }
    if (result.ok === false) {
      return { ok: false, error: typeof result.error === 'string' ? result.error : 'save-failed' };
    }
    const published = typeof result.path === 'string' && result.path.length > 0 ? result.path : null;
    if (!published) return { ok: false, error: 'save-not-published' };
    let real;
    try {
      real = sessions.requireNativeOutput(ctx.viewId, published);
    } catch (error) {
      if (error instanceof LabProtocolError) return { ok: false, error: 'save-not-published', code: error.code };
      throw error;
    }
    if (!existsSync(real)) return { ok: false, error: 'save-not-published', code: 'path_not_found' };
    let onDisk;
    try {
      onDisk = await readFileBytes(real);
      assertNonEmptyBytes(onDisk, real);
    } catch (error) {
      if (error instanceof LabProtocolError) return { ok: false, error: 'save-not-published', code: error.code };
      throw error;
    }
    const bytes = onDisk.length;
    const digest = sha256(onDisk);
    sync.savedPath = real;
    // The name of the VERIFIED publication is the saved state a later ordinary
    // save reuses; it comes from the proven path, never from a caller target.
    sync.savedName = basename(real);
    ctx.session.dirty = false;
    ctx.session.output = { path: real, bytes, sha256: digest, at: now() };
    if (selectOutput) ctx.session.savePath = real;
    const slidesContext = bridge.requestContext(ctx.viewId);
    const slidesChannel = selectOutput ? 'host:slides-save-as' : 'host:slides-save';
    const slidesDeclared = typeof result.sha256 === 'string' ? result.sha256 : null;
    const slidesRecorded = bridge.recordSave({
      channel: slidesChannel,
      session: ctx.session,
      requestDigest: slidesContext && slidesContext.channel === slidesChannel ? slidesContext.requestDigest : null,
      declared: slidesContext ? slidesContext.declared : null,
      userAgent: slidesContext ? slidesContext.userAgent : null,
      output: { path: real, declaredSha256: slidesDeclared, declaredBytes: bytes },
    });
    if (slidesRecorded) {
      record({ view: ctx.viewId, op: 'slides-save', path: real, bytes, sha256: digest, bridge: slidesRecorded.stamp });
      events.emit(ctx.viewId, 'saved', { op: 'slides-save', path: real, bytes, bridge: slidesRecorded.stamp });
    }
    // slides is echoed only if the real route returned a render tree (it does not today).
    return { ok: true, path: real, savedPath: real, bytes, sha256: digest,
      ...(slidesRecorded ? { bridge: slidesRecorded.stamp } : {}),
      slides: Array.isArray(result.slides) ? result.slides : null,
      count: Number.isInteger(result.count) ? result.count : null };
  };

  /** The native publication name of this deck, inside the r5-proved nativeOutDir. */
  const deckName = (sync, name) => join(sync.nativeOutDir, sanitizeName(name ?? 'untitled.pptx'));
  /** The server-derived native publication name of this view deck. */
  const deckTargetFor = (ctx, requestedName) => {
    const sync = ctx.session.pptx;
    if (!sync) throw new LabProtocolError('invalid_input', 'slides save needs an open deck for this view');
    // Save-as names the next publication. An ordinary save reuses the name of the
    // deck's last VERIFIED same-view publication, falling back to the opened source.
    const chosen = typeof requestedName === 'string' && requestedName.length > 0
      ? requestedName
      : (typeof sync.savedName === 'string' && sync.savedName.length > 0
        ? sync.savedName
        : basename(ctx.session.sourcePath ?? 'untitled.pptx'));
    const name = withExtension(chosen, '.pptx');
    return { name, target: deckName(sync, name), sync };
  };

  // Lab-only candidate (Advisor decision g117 option (a)): the two real render capabilities the
  // PDF image-edit flow needs - the image bake source and the live page preview. Both render with
  // the real pdfjs + napi-rs canvas path from the prepared source; no stub image is ever returned.
  const pageImagePngSource = typeof sourceRoot === 'string' && sourceRoot.length > 0
    ? sourceRoot
    : (typeof sourceDir === 'string' && sourceDir.length > 0 ? sourceDir : null);
  const pageImagePngHandler = pageImagePngSource === null
    ? null
    : createPageImagePngHandler({ sourceRoot: pageImagePngSource });
  const pagePreviewPngHandler = pageImagePngSource === null
    ? null
    : createPagePreviewPngHandler({ sourceRoot: pageImagePngSource });

  const handlers = {
    // ── lab control plane ─────────────────────────────────────────────────
    'lab:session-open': async (_ctx, body) => {
      const app = body.app;
      if (typeof app !== 'string' || !LAB_APPS.includes(app)) {
        throw new LabProtocolError('unknown_app', 'lab:session-open needs one of ' + LAB_APPS.join(', '));
      }
      const path = body.path === undefined ? null : body.path;
      if (path !== null && typeof path !== 'string') {
        throw new LabProtocolError('invalid_input', 'lab:session-open path must be a string or null');
      }
      if (body.fixtureId !== undefined && body.fixtureId !== null && typeof body.fixtureId !== 'string') {
        throw new LabProtocolError('invalid_input', 'lab:session-open fixtureId must be a string');
      }
      // A manifest fixture is named by its ID, never by a path the caller chose: the bridge resolves
      // the entry from the manifest and refuses when the bytes on disk are not byte-equal to it.
      const openTarget = bridge.resolveOpenTarget({
        app,
        target: body.fixtureId === undefined || body.fixtureId === null ? path : body.fixtureId,
      });
      // A caller-supplied viewId is ignored on purpose: the server mints it.
      const session = await sessions.open({ app, path: openTarget.sourcePath });
      bridge.attachFixture(session, openTarget.fixture);
      // The bytes the session copied must equal the fixture that was validated. A file changed between
      // the validation read and the copy must not become a view: the view is dropped and the open is
      // refused with the same named error.
      try {
        bridge.verifyCopiedFixture(session, openTarget.fixture);
      } catch (error) {
        sessions.byId.delete(session.viewId);
        throw error;
      }
      previews.register(session);
      events.register(session.viewId);
      record({ view: session.viewId, op: 'session-open', app, path: session.sourcePath });
      return {
        viewId: session.viewId,
        app: session.app,
        path: session.sourcePath,
        name: session.sourceName,
        hash: session.sourceHash,
        size: session.sourceBytes,
        workingPath: session.workingPath,
        previewToken: session.previewToken,
        // CONTRACT-v1 section 4: the manifest identity of the immutable input, computed by the
        // adapter. A session opened by raw path carries fixture: null and can never claim an id.
        fixture: openTarget.fixture,
        bridge: { contract: bridge.contract },
      };
    },

    'lab:session-close': async (ctx) => {
      events.close(ctx.viewId);
      // Both preview maps: dropping only the view entry left the token serving
      // the last buffer after the view was closed.
      previews.close(ctx.viewId);
      sessions.byId.delete(ctx.viewId);
      record({ view: ctx.viewId, op: 'session-close' });
      return { ok: true, viewId: ctx.viewId };
    },

    'lab:events-poll': async (ctx, body) => events.drain(ctx.viewId, Number(body.after ?? 0) || 0),

    'lab:events-wait': async (ctx, body) =>
      events.wait(ctx.viewId, Number(body.after ?? 0) || 0, Number(body.timeoutMs ?? 25000) || 25000),

    'lab:events-record': async () => ({ ok: true, events: records.slice() }),

    // ── docs ──────────────────────────────────────────────────────────────
    'host:docs-consume-pending-open': async (ctx) => {
      if (!ctx.session.workingPath) return null;
      return entryOf(ctx.session.workingPath);
    },

    'host:docs-open-path': async (ctx, body) => {
      const real = readGranted(ctx.session, body.path);
      return entryOf(real);
    },

    'host:docs-save': async (ctx, body) => {
      const bytes = decodeBase64Strict(body.dataBase64, { field: 'dataBase64' });
      const target = body.path ?? ctx.session.savePath ?? ctx.session.workingPath;
      if (!target) throw new LabProtocolError('invalid_input', 'docs save needs a granted path');
      return writeForView(ctx.session, target, bytes, 'docs-save');
    },

    'host:docs-save-new': async (ctx, body) => {
      const bytes = decodeBase64Strict(body.dataBase64, { field: 'dataBase64' });
      const target = outputTargetFor(ctx.session, withExtension(body.defaultName, '.docx'));
      const result = await writeForView(ctx.session, target, bytes, 'docs-save-new');
      ctx.session.savePath = result.path;
      return result;
    },

    'host:docs-save-as': async (ctx, body) => {
      const bytes = decodeBase64Strict(body.dataBase64, { field: 'dataBase64' });
      const target = outputTargetFor(ctx.session, withExtension(body.defaultName, '.docx'));
      const result = await writeForView(ctx.session, target, bytes, 'docs-save-as');
      ctx.session.savePath = result.path;
      return result;
    },

    'host:docs-save-to': async (ctx, body) => {
      const bytes = decodeBase64Strict(body.dataBase64, { field: 'dataBase64' });
      const target = sessions.requireWriteGrant(ctx.session.viewId, body.path);
      if (existsSync(target) && body.overwrite !== true) {
        throw new LabProtocolError(
          'save_conflict',
          'target exists and overwrite was not requested: ' + target,
          { path: target },
        );
      }
      const result = await writeForView(ctx.session, target, bytes, 'docs-save-to');
      ctx.session.savePath = result.path;
      return result;
    },

    'host:docs-consume-new-blank': async () => ({ blank: true }),

    // An empty boot queue is a real empty result: the lab has no AI content and
    // no headless export pending. It is not a fabricated successful operation.
    'host:docs-consume-ai-doc-content': async (ctx) => {
      record({ view: ctx.viewId, op: 'consume-ai-doc-content', empty: true });
      return null;
    },

    'host:docs-consume-headless-export': async (ctx) => {
      record({ view: ctx.viewId, op: 'consume-headless-export', empty: true });
      return null;
    },

    'host:docs-write-recovery': async (ctx, body) => {
      const bytes = decodeBase64Strict(body.dataBase64, { field: 'dataBase64' });
      const dir = join(roots.tmpDir, 'recovery', ctx.viewId);
      const target = join(dir, sanitizeName(basename(String(body.path ?? 'recovery')), 'recovery'));
      const real = roots.requireWrite(target);
      assertNonEmptyBytes(bytes, real);
      const written = await writeFileAtomic(real, bytes);
      record({ view: ctx.viewId, op: 'docs-write-recovery', path: real });
      return { ok: true, path: written.path, bytes: written.bytes, sha256: written.sha256 };
    },

    'host:close-check': async (ctx, body) => ({ ok: true, viewId: ctx.viewId, payload: body ?? {} }),

    'host:view-menu-state': async (ctx, body) => ({ ok: true, viewId: ctx.viewId, state: body ?? {} }),

    'host:dirty': async (ctx, body) => {
      if (typeof body.dirty !== 'boolean') {
        throw new LabProtocolError('invalid_input', 'host:dirty needs a boolean dirty value');
      }
      ctx.session.dirty = body.dirty;
      record({ view: ctx.viewId, op: 'dirty', dirty: body.dirty });
      return { ok: true, viewId: ctx.viewId, dirty: body.dirty };
    },

    // The renderer's pending-edit badge count (preload/index.ts:409-412 floors it to a
    // non-negative integer before the IPC send, and App.tsx:505-507 feeds it on every change).
    // The server mirrors that contract exactly: a count that is not a non-negative finite number
    // is refused by name, so a malformed report can never be recorded as a real edit count.
    'host:pending-edits': async (ctx, body) => {
      if (typeof body.count !== 'number' || !Number.isFinite(body.count) || body.count < 0) {
        throw new LabProtocolError('invalid_input', 'host:pending-edits needs a non-negative edit count');
      }
      const count = Math.floor(body.count);
      ctx.session.pendingEdits = count;
      record({ view: ctx.viewId, op: 'pending-edits', count });
      return { ok: true, viewId: ctx.viewId, pendingEdits: count };
    },

    // ── text (markdown + html) ────────────────────────────────────────────
    'host:markdown-read-link': async (ctx, body) => {
      if (ctx.session.app !== 'markdown') {
        throw new LabProtocolError('wrong_view', 'markdown text links are not granted to this view');
      }
      const href = typeof body.href === 'string' ? body.href.split(/[?#]/, 1)[0] : '';
      const real = sessions.requireReadAsset(ctx.viewId, href);
      if (extname(real).toLowerCase() !== '.txt') {
        throw new LabProtocolError('invalid_input', 'only plain-text attachments can be opened');
      }
      return { name: basename(real), text: (await readFileBytes(real)).toString('utf8') };
    },
    'host:text-consume-pending': async (ctx) => {
      if (!ctx.session.workingPath || ctx.session.pendingConsumed === true) return null;
      ctx.session.pendingConsumed = true;
      return ctx.session.workingPath;
    },

    'host:text-read': async (ctx, body) => {
      const real = readGranted(ctx.session, body.path);
      return (await readFileBytes(real)).toString('utf8');
    },

    'host:text-save': async (ctx, body) => {
      // The server owns the format: the app identity of the session decides the
      // extension, so a client `ext` can never redirect the write.
      const ext = ctx.session.app === 'html' ? '.html' : '.md';
      const text = body.text;
      if (typeof text !== 'string') {
        throw new LabProtocolError('invalid_input', 'text save needs the serialized document text');
      }
      const saveAs = body.mode === 'saveAs';
      const target =
        !saveAs && ctx.session.savePath
          ? ctx.session.savePath
          : outputTargetFor(ctx.session, withExtension(body.suggestedName, ext));
      // A text editor writes UTF-8. Refuse an empty-forbidden container even if a
      // session were ever pointed at one, so a text save can never corrupt a
      // docx/xlsx/pptx/pdf/image by writing text bytes into it.
      const policy = byteFormatFor(target);
      if (policy.emptyAllowed === false) {
        throw new LabProtocolError(
          'invalid_input',
          'a text-editor save cannot write ' + (policy.ext || 'a binary') +
            ' bytes as UTF-8: ' + String(target),
          { ext: policy.ext },
        );
      }
      const result = await writeForView(ctx.session, target, Buffer.from(text, 'utf8'), 'text-save');

      ctx.session.savePath = result.path;
      // HTML saves omit the image list; discover its references without changing authored text.
      const imageSources = ctx.session.app === 'html'
        ? mergeImageSources(body.imageSources, discoverHtmlImageSources(text))
        : ctx.session.app === 'markdown'
          ? mergeImageSources(body.imageSources, discoverMarkdownSources(text))
          : body.imageSources;
      const stylesheets = ctx.session.app === 'html' ? discoverHtmlStylesheets(text) : [];
      const assets = await preserveRelativeAssets(ctx.session, result.path, imageSources, stylesheets);
      if (assets.preserved.length > 0 || assets.skipped.length > 0) {
        record({ view: ctx.viewId, op: 'text-save-assets', preserved: assets.preserved, skipped: assets.skipped });
      }
      return { ...result, assets };
    },

    'host:text-save-image': async (ctx, body) => {
      if (!ctx.session.savePath) return null;
      const bytes = decodeBase64Strict(body.base64, { field: 'base64' });
      assertNonEmptyBytes(bytes, 'image.png');
      const dir = join(dirname(ctx.session.savePath), 'assets');
      const target = join(dir, withExtension(String(body.name ?? 'image'), '.' + sanitizeName(body.ext ?? 'png', 'png')));
      const result = await writeForView(ctx.session, target, bytes, 'text-save-image');
      return { ok: true, path: result.path, relative: 'assets/' + basename(result.path), sha256: result.sha256 };
    },

    'host:text-read-image': async (ctx, body) => {
      const src = String(body.src ?? '');
      if (/^data:/i.test(src)) {
        const comma = src.indexOf(',');
        const mime = src.slice(5, comma).split(';')[0] || 'image/png';
        return { base64: src.slice(comma + 1), mime };
      }
      const base = ctx.session.sourceDir ?? ctx.session.workingDir;
      const real = sessions.requireReadGrant(ctx.session.viewId, join(base, src.replace(/^\/+/, '')));
      const bytes = await readFileBytes(real);
      const ext = extname(real).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
      return { base64: bytes.toString('base64'), mime };
    },

    /**
     * The pinned renderer calls `host:image-read` and expects upstream's real
     * `ImageData | null`: a source with any scheme (data:, http:, a drive letter
     * or a UNC path) and a file that is not an image both resolve to `null`, the
     * way html:read-image / markdown:read-image do. A grant refusal is still the
     * loud named error every other lab read raises, never a silent null.
     */
    'host:image-read': async (ctx, body) => {
      const src = String(body.src ?? '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
      const base = ctx.session.sourceDir ?? ctx.session.workingDir;
      const real = sessions.requireReadGrant(ctx.session.viewId, join(base, src.replace(/^\/+/, '')));
      const mime = imageMimeFor(real);
      if (!mime) return null;
      const bytes = await readFileBytes(real);
      return { base64: bytes.toString('base64'), mime };
    },

    // ── html preview ──────────────────────────────────────────────────────
    'host:html-preview-info': async (ctx) => ({
      url: previewOrigin + '/' + ctx.session.previewToken + '/',
      token: ctx.session.previewToken,
      version: previews.byViewId.get(ctx.viewId)?.version ?? 0,
    }),

    'host:html-update-preview': async (ctx, body) => {
      if (typeof body.text !== 'string') {
        throw new LabProtocolError('invalid_input', 'preview update needs the buffer text');
      }
      // The version is stored before the ack, so a reload issued after this
      // response cannot publish an older buffer.
      const published = previews.publish(ctx.viewId, body.text);
      record({ view: ctx.viewId, op: 'preview-update', version: published.version });
      return { ok: true, version: published.version, updatedAt: published.updatedAt };
    },

    'host:html-preview-document': async (ctx, body) => {
      // The token ROOT, not <token>/assets/: the document authors "assets/dot.png",
      // so an assets/ root would resolve it to assets/assets/dot.png. The preview
      // asset route serves the file once, under the token root.
      const baseHref = previewTokenBase(previewOrigin, ctx.session.previewToken);
      return { ok: true, document: buildPreviewDocument(String(body.text ?? ''), baseHref) };
    },

    // ── pdf ───────────────────────────────────────────────────────────────
    // The pdf renderer's getUsername is the default author of a new note comment. The real
    // main process answers the OS account name and '' when that is unavailable
    // (apps/pdf/src/main/pdf-main.ts:839-845); the lab answers the same honest "unavailable"
    // value. It never invents a person and never writes the operator's account name into lab
    // evidence. Implementing the channel answers a string instead of the 404 unknown_channel
    // that made App.tsx:383's getUsername() rejection be swallowed.
    'host:username': async () => ({ name: '' }),

    'host:pdf-consume-pending': async (ctx) => {
      if (!ctx.session.workingPath || ctx.session.pendingConsumed === true) return null;
      ctx.session.pendingConsumed = true;
      return ctx.session.workingPath;
    },

    'host:pdf-read-file': async (ctx, body) => {
      const real = readGranted(ctx.session, body.path);
      const bytes = await readFileBytes(real);
      return { base64: bytes.toString('base64'), size: bytes.length, sha256: sha256(bytes) };
    },

    'host:pdf-auto-rename': async (ctx, body) => {
      const real = readGranted(ctx.session, body.path);
      const candidate = sanitizeName(body.nameCandidate ?? basename(real), basename(real));
      const target = join(dirname(real), withExtension(candidate, '.pdf'));
      if (target === real) return { renamed: false, path: real, name: basename(real) };
      const result = await writeForView(ctx.session, target, await readFileBytes(real), 'pdf-auto-rename');
      ctx.session.savePath = result.path;
      return { renamed: true, path: result.path, name: basename(result.path) };
    },

    'host:pdf-is-untitled': async (ctx, body) => {
      const real = readGranted(ctx.session, body.path);
      return real === ctx.session.workingPath;
    },

    'host:pdf-page-image-png': async (ctx, body) => {
      const real = readGranted(ctx.session, body.path);
      if (pageImagePngHandler === null) {
        throw new LabProtocolError('engine_unsupported', 'the lab was started without a prepared source root, so pageImagePng cannot render');
      }
      try {
        return await pageImagePngHandler({ ...body, path: real });
      } catch (error) {
        if (error instanceof PageImagePngError) {
          throw new LabProtocolError('invalid_input', 'pageImagePng refused: ' + error.message, { code: error.code, detail: error.detail === undefined ? null : error.detail });
        }
        throw error;
      }
    },

    'host:pdf-page-preview-png': async (ctx, body) => {
      const real = readGranted(ctx.session, body.path);
      if (pagePreviewPngHandler === null) {
        throw new LabProtocolError('engine_unsupported', 'the lab was started without a prepared source root, so pagePreviewPng cannot render');
      }
      try {
        return await pagePreviewPngHandler({ ...body, path: real });
      } catch (error) {
        if (error instanceof PageImagePngError) {
          throw new LabProtocolError('invalid_input', 'pagePreviewPng refused: ' + error.message, { code: error.code, detail: error.detail === undefined ? null : error.detail });
        }
        throw error;
      }
    },

    'host:pdf-save': async (ctx, body) => {
      // The body IS the real SavePdfRequest (path + edits). /engine/pdf-save-request reads
      // input.request, input.path and input.viewId and publishes under ctx.outDir(viewId) =
      // <lab>/out/<viewId>; it never reads sourcePath/targetPath, so those dead fields are dropped
      // rather than echoed. The view id is the server-owned session id, never body.viewId.
      const source = readGranted(ctx.session, body.path);
      const result = await engineCall(ctx.session, 'pdf-save', {
        path: source,
        request: stripLabFields(body),
        viewId: ctx.session.viewId,
      });
      if (!result || typeof result !== 'object' || result.ok !== true) {
        throw new LabProtocolError(
          'engine_error',
          'engine did not confirm the pdf save: ' + String((result && result.error) ?? 'no result'),
        );
      }
      // The engine reports where it published; the server invents no destination.
      const published = typeof result.path === 'string' && result.path.length > 0 ? result.path : null;
      if (!published) return { status: 'error', reason: 'save-not-published' };
      let real;
      try {
        // Proven inside the SERVER-derived native output dir of THIS view by the sole shared grant
        // (XLSX correction FOUR/r5). The pre-save working copy, views/<id>/out, another view's
        // output, the rest of lab/out, anything outside lab and a junction resolving out of
        // nativeOutDir are refused here, before any state change.
        real = sessions.requireNativeOutput(ctx.viewId, published);
      } catch (error) {
        if (error instanceof LabProtocolError) {
          return { status: 'error', reason: 'save-not-published', error: error.code };
        }
        throw error;
      }
      if (!existsSync(real)) {
        return { status: 'error', reason: 'save-not-published', error: 'path_not_found' };
      }
      let onDisk;
      try {
        onDisk = await readFileBytes(real);
        assertNonEmptyBytes(onDisk, real);
      } catch (error) {
        if (error instanceof LabProtocolError) {
          return { status: 'error', reason: 'save-not-published', error: error.code };
        }
        throw error;
      }
      // Bytes/hash are read back from the published file; the engine claim is never trusted.
      // State, the record log and the event bus move only now.
      const savedBytes = onDisk.length;
      const savedSha256 = sha256(onDisk);
      // The renderer reloads this exact validated publication and uses it for later saves.
      sessions.authorizeRead(ctx.viewId, real);
      ctx.session.savePath = real;
      ctx.session.output = { path: real, bytes: savedBytes, sha256: savedSha256, at: now() };
      // CONTRACT-v1: the receipt names the digest the ENGINE declared when it declared one, so the
      // adapter's own read-back is a real second opinion rather than a restatement.
      const pdfContext = bridge.requestContext(ctx.viewId);
      const pdfDeclared = typeof result.sha256 === 'string' ? result.sha256
        : typeof result.persistedHash === 'string' ? result.persistedHash : null;
      const pdfRecorded = bridge.recordSave({
        channel: 'host:pdf-save',
        session: ctx.session,
        requestDigest: pdfContext ? pdfContext.requestDigest : null,
        declared: pdfContext ? pdfContext.declared : null,
        userAgent: pdfContext ? pdfContext.userAgent : null,
        output: { path: real, declaredSha256: pdfDeclared, declaredBytes: savedBytes },
      });
      if (pdfRecorded) {
        record({ view: ctx.viewId, op: 'pdf-save', path: real, bytes: savedBytes, sha256: savedSha256, bridge: pdfRecorded.stamp });
        events.emit(ctx.viewId, 'saved', { op: 'pdf-save', path: real, bytes: savedBytes, bridge: pdfRecorded.stamp });
      }
      return Object.assign({}, result, {
        ok: true, status: 'ok', savedPath: real, bytes: savedBytes, sha256: savedSha256,
        ...(pdfRecorded ? { bridge: pdfRecorded.stamp } : {}),
      });
      // Refusal shape { status:'error', reason:'save-not-published', error:<code> } is the same
      // honest-refusal contract XLSX correction r4 uses: HTTP 200 non-success, never a fake save,
      // and every refusal returns before any session/record/event mutation.
    },

    'host:pdf-validate-text-edits': async (ctx, body) => {
      const source = readGranted(ctx.session, body.path);
      // /engine/pdf-validate-text reads input.path and input.textEdits (engine-pdf-routes.mts:98-102).
      // The renderer sends the real ValidateTextEditsRequest { path, edits } (ipc.ts:525-528), so the
      // server names both engine fields explicitly instead of forwarding the dead sourcePath/request
      // pair that made the engine answer 502 "a lab path string is required".
      const result = await engineCall(ctx.session, 'pdf-validate-text-edits', { path: source, textEdits: body.edits });
      // The renderer contract is TextEditValidation[] (ipc.ts:695); the route answers { validation },
      // so the array itself is returned and a non-array answer is refused rather than passed through.
      const validation = result && typeof result === 'object' ? result.validation : null;
      if (!Array.isArray(validation)) {
        throw new LabProtocolError('engine_invalid_response', 'pdf-validate-text did not answer a validation array');
      }
      return validation;
    },

    'host:pdf-list-page-images': async (ctx, body) => {
      const source = readGranted(ctx.session, body.path);
      // /engine/pdf-list-images reads input.path (engine-pdf-routes.mts:151-154); the renderer's
      // listPageImages contract is PageImageRef[] (ipc.ts:702), not the { images } route envelope.
      const result = await engineCall(ctx.session, 'pdf-list-page-images', { path: source });
      const images = result && typeof result === 'object' ? result.images : null;
      if (!Array.isArray(images)) {
        throw new LabProtocolError('engine_invalid_response', 'pdf-list-images did not answer an images array');
      }
      return images;
    },

    'host:pdf-list-static-form-fills': async (ctx, body) => {
      const source = readGranted(ctx.session, body.path);
      // /engine/pdf-list-form-fills reads input.path (engine-pdf-routes.mts:184-187); the renderer
      // contract is StaticFormFillRecord[] (ipc.ts:704), not the { fills } route envelope. This is
      // the channel observed answering 502 "a lab path string is required" in the r16 capture.
      const result = await engineCall(ctx.session, 'pdf-list-static-form-fills', { path: source });
      const fills = result && typeof result === 'object' ? result.fills : null;
      if (!Array.isArray(fills)) {
        throw new LabProtocolError('engine_invalid_response', 'pdf-list-form-fills did not answer a fills array');
      }
      return fills;
    },

    'host:pdf-edit-fonts': async (ctx) => engineCall(ctx.session, 'pdf-edit-fonts', {}),

    // The pinned renderer's listEditFonts contract is string[] (ipc.ts:697); both font routes are
    // served by /engine/pdf-fonts, which answers { fonts, canDrawText } (engine-pdf-routes.mts:88-96),
    // so this channel returns the array itself instead of the envelope.
    'host:pdf-list-edit-fonts': async (ctx) => {
      const result = await handlers['host:pdf-edit-fonts'](ctx, {});
      const fonts = result && typeof result === 'object' ? result.fonts : null;
      if (!Array.isArray(fonts)) {
        throw new LabProtocolError('engine_invalid_response', 'pdf-fonts did not answer a fonts array');
      }
      return fonts;
    },

    // The pinned adapter reads a boolean, or the `drawable` flag (host-adapter.mjs:756-761 flagOf);
    // /engine/pdf-fonts answers { fonts, canDrawText }, so the server maps the engine field onto the
    // renderer's name instead of leaking the fonts envelope through a boolean channel.
    'host:pdf-can-draw-text': async (ctx, body) => {
      const result = await engineCall(ctx.session, 'pdf-can-draw-text', {
        text: String(body.text ?? ''),
        font: body.font ?? null,
        bold: body.bold === true,
        italic: body.italic === true,
      });
      const drawable = result && typeof result === 'object' ? result.canDrawText : null;
      if (typeof drawable !== 'boolean') {
        throw new LabProtocolError('engine_invalid_response', 'pdf-fonts did not answer a canDrawText boolean');
      }
      return { drawable };
    },

    // ── sheets ────────────────────────────────────────────────────────────
    'host:sheets-consume-new-blank': async () => ({ blank: true }),

    'host:sheets-has-queued': async (ctx) => ({
      queued: Boolean(ctx.session.workingPath && !ctx.session.pendingConsumed),
    }),

    'host:sheets-select-workbook': async (ctx, body) => {
      const source = readGranted(ctx.session, body.path ?? ctx.session.workingPath);
      ctx.session.pendingConsumed = true;
      return engineCall(ctx.session, 'xlsx-open', { sourcePath: source, viewId: ctx.viewId });
    },

    'host:sheets-read-range': async (ctx, body) =>
      engineCall(ctx.session, 'xlsx-read-range', { request: stripLabFields(body), viewId: ctx.viewId }),

    'host:sheets-read-formulas': async (ctx, body) =>
      engineCall(ctx.session, 'xlsx-read-formulas', { request: stripLabFields(body), viewId: ctx.viewId }),

    'host:sheets-recalc': async (ctx, body) =>
      engineCall(ctx.session, 'xlsx-recalc', { request: stripLabFields(body), viewId: ctx.viewId }),

    'host:sheets-save-edits': async (ctx, body) => {
      // The engine route takes the request fields FLAT plus the server-owned viewId.
      // request: and targetPath: were dead fields there (the route reads input.edits /
      // input.name / input.formulaValues / input.structuralOps and publishes under
      // ctx.outDir(viewId) = <lab>/out/<viewId>). They are dropped, not echoed.
      const result = await engineCall(ctx.session, 'xlsx-save', {
        ...stripLabFields(body),
        viewId: ctx.viewId,
      });
      // The server reports the ACTUAL published output, never a working copy.
      const published =
        result && typeof result === 'object' && result.saved && typeof result.saved.path === 'string'
          ? result.saved.path
          : null;
      if (!published) return { status: 'error', reason: 'save-not-published' };
      let real;
      try {
        // Proven inside the SERVER-derived native output directory of THIS view
        // (Amendment C), then granted by the ordinary write-grant check: a stale working
        // path, views/<id>/out, another view, the rest of lab/out, an engine-named
        // directory or a junction escape is refused here and never reported. No mutation.
        real = sessions.requireNativeOutput(ctx.viewId, published);
      } catch (error) {
        if (error instanceof LabProtocolError) return { status: 'error', reason: 'save-not-published', error: error.code };
        throw error;
      }
      if (!existsSync(real)) return { status: 'error', reason: 'save-not-published', error: 'path_not_found' };
      let onDisk;
      try {
        onDisk = await readFileBytes(real);
        assertNonEmptyBytes(onDisk, real);
      } catch (error) {
        if (error instanceof LabProtocolError) return { status: 'error', reason: 'save-not-published', error: error.code };
        throw error;
      }
      const savedBytes = onDisk.length;
      const savedSha256 = sha256(onDisk);
      // Only a proven, non-empty published file reaches saved state, the record log and
      // the event bus. Every early return above is side-effect free.
      ctx.session.savePath = real;
      ctx.session.output = { path: real, bytes: savedBytes, sha256: savedSha256, at: now() };
      const sheetsContext = bridge.requestContext(ctx.viewId);
      const sheetsDeclared = typeof result.sha256 === 'string' ? result.sha256
        : typeof result.saved === 'object' && result.saved && typeof result.saved.sha256 === 'string' ? result.saved.sha256 : null;
      const sheetsRecorded = bridge.recordSave({
        channel: 'host:sheets-save-edits',
        session: ctx.session,
        requestDigest: sheetsContext ? sheetsContext.requestDigest : null,
        declared: sheetsContext ? sheetsContext.declared : null,
        userAgent: sheetsContext ? sheetsContext.userAgent : null,
        output: { path: real, declaredSha256: sheetsDeclared, declaredBytes: savedBytes },
      });
      if (sheetsRecorded) {
        record({ view: ctx.viewId, op: 'sheets-save', path: real, bytes: savedBytes, sha256: savedSha256, bridge: sheetsRecorded.stamp });
        events.emit(ctx.viewId, 'saved', { op: 'sheets-save', path: real, bytes: savedBytes, bridge: sheetsRecorded.stamp });
      }
      return { ...result, status: 'ok', savedPath: real, bytes: savedBytes, sha256: savedSha256,
        ...(sheetsRecorded ? { bridge: sheetsRecorded.stamp } : {}) };
    },

    // The renderer's own close command. The REAL engine route retires the held workbook state and
    // answers { closed, sessionId }; this handler records the outcome and reports it instead of the
    // former engine_unsupported 501. The server-owned viewId scopes the sessionId guard;
    // sessionId cannot select another view's workbook, and a reply that is not an object with a
    // boolean `closed` is a NAMED refusal rather than an unverified close.
    'host:sheets-close': async (ctx, body) => {
      const result = await engineCall(ctx.session, 'xlsx-close', {
        viewId: ctx.viewId,
        ...(body?.sessionId === undefined ? {} : { sessionId: body.sessionId }),
      });
      if (!result || typeof result !== 'object' || typeof result.closed !== 'boolean') {
        throw new LabProtocolError(
          'engine_invalid_response',
          'xlsx-close did not answer a boolean closed state',
        );
      }
      // A close of a view whose workbook was never opened is a real answer (closed:false), not a
      // failure; it is recorded as such so a later step can tell the two apart.
      record({ view: ctx.viewId, op: 'sheets-close', closed: result.closed });
      return { ok: true, viewId: ctx.viewId, closed: result.closed };
    },

    'host:sheets-auto-rename': async (ctx, body) =>
      engineCall(ctx.session, 'xlsx-auto-rename', { sessionId: body.sessionId, baseName: body.baseName, viewId: ctx.viewId }),

    'host:sheets-write-recovery': async (ctx, body) =>
      engineCall(ctx.session, 'xlsx-write-recovery', { request: stripLabFields(body), viewId: ctx.viewId }),

    'host:sheets-reply-recovery': async (ctx, body) =>
      engineCall(ctx.session, 'xlsx-reply-recovery', { answer: body.answer, viewId: ctx.viewId }),

    // ── slides ────────────────────────────────────────────────────────────
    'host:slides-consume-pending': async (ctx, body) => {
      if (!ctx.session.workingPath) return null;
      const result = await engineCallTracked(ctx.session, 'pptx-open', {
        path: ctx.session.workingPath,
        fitWidthPx: body.fitWidthPx ?? null,
        viewId: ctx.viewId,
      });
      ctx.session.pendingConsumed = true;
      return result;
    },

    'host:slides-open': async (ctx, body) => {
      const source = readGranted(ctx.session, body.path ?? ctx.session.workingPath);
      return engineCallTracked(ctx.session, 'pptx-open', {
        path: source,
        fitWidthPx: body.fitWidthPx ?? null,
        viewId: ctx.viewId,
      });
    },

    'host:slides-new-blank': async (ctx, body) =>
      engineCall(ctx.session, 'pptx-new-blank', { fitWidthPx: body.fitWidthPx ?? null, viewId: ctx.viewId }),

    'host:slides-layouts': async (ctx) => engineCall(ctx.session, 'pptx-layouts', { viewId: ctx.viewId }),

    'host:slides-is-dirty': async (ctx) => {
      // Real route /engine/pptx-is-dirty answers { dirty: session.dirty }; every edit route sets it.
      // A malformed or engine-less answer is a named refusal, never silently a saved/clean deck
      // (that would keep the Ribbon.tsx QAT Save button disabled forever).
      const state = await engineCall(ctx.session, 'pptx-is-dirty', { viewId: ctx.viewId });
      if (!state || typeof state !== 'object' || typeof state.dirty !== 'boolean') {
        throw new LabProtocolError('dirty_unavailable', 'pptx-is-dirty returned no dirty flag');
      }
      return { dirty: state.dirty };
    },

    // setAutoSavePref is a one-way NOTIFICATION: upstream ipcMain.on('slides:autosave-pref', ...)
    // answers nothing, the adapter's send() does not await a reply, and the renderer owns the
    // preference state itself (plus the adapter's own prefs). So this channel stores NOTHING and
    // answers the documented no-payload shape - a value-shaped { on } would read as "preference
    // persisted" when in fact no state was written. It still answers 200 so the lab transport
    // does not record a false 404 diagnostic on reopen.
    'host:autosave-pref': async (ctx, body) => {
      record({ view: ctx.viewId, op: 'autosave-pref', on: body.on === true, stored: false });
      return null;
    },

    'host:slides-edit-text': async (ctx, body) => {
      // The adapter already forwards host:slides-edit-text (host-adapter.mjs editText); only this
      // server channel was missing. The real engine route returns the envelope { ok, slideIndex,
      // sourceId, elementType, beforeText, afterText, applied, failures, slide }
      // (engine-pptx-routes.mts editText). commitEdit (App.tsx:2337) inserts the resolved value
      // into slides state and needs the RenderSlide itself, so success unwraps result.slide and a
      // non-applied edit stays a refusal.
      const result = await engineCall(ctx.session, 'pptx-edit-text', {
        viewId: ctx.viewId,
        slideIndex: body.slideIndex ?? body.slide ?? 0,
        sourceId: body.sourceId ?? body.el ?? null,
        paragraphs: Array.isArray(body.paragraphs) ? body.paragraphs : [],
        groupId: body.groupId ?? null,
      });
      if (!result || typeof result !== 'object' || result.applied !== true || !result.slide) {
        throw new LabProtocolError(
          'edit_not_applied',
          'pptx-edit-text did not apply the edit' +
            (result && Array.isArray(result.failures) ? ': ' + result.failures.join('; ') : ''),
        );
      }
      return result.slide;
    },

    // S-OWNED EXTENSION (not in the frozen CONTRACT-v1 build): the renderer own shape gesture
    // (drag / resize / rotate -> App.tsx onTransform -> slidesApi.editTransform) posts
    // `host:slides-edit-transform`, which the frozen lab does not implement, so a real shape edit
    // was refused 404 unknown_channel. This handler forwards the renderer own payload verbatim to
    // the REAL engine route /engine/pptx-edit-transform (engine-pptx-routes.mts editTransform); the
    // engine operation is bound only because the runner declares it (--extra-engine-ops).
    'host:slides-edit-transform': async (ctx, body) => {
      const result = await engineCall(ctx.session, 'pptx-edit-transform', {
        viewId: ctx.viewId,
        slideIndex: body.slideIndex ?? body.slide ?? 0,
        sourceId: body.sourceId ?? body.el ?? null,
        xPx: body.xPx,
        yPx: body.yPx,
        wPx: body.wPx,
        hPx: body.hPx,
        rotationDeg: body.rotationDeg ?? 0,
        fitWidthPx: body.fitWidthPx ?? null,
        groupId: body.groupId ?? null,
      });
      if (!result || typeof result !== 'object' || !result.slide) {
        throw new LabProtocolError(
          'edit_not_applied',
          'pptx-edit-transform did not apply the transform',
        );
      }
      return result.slide;
    },

    // The lab stand-in for the renderer's native picture dialog
    // (ipc.ts:1354 `pickPictureFile`, slides-main.ts:2288-2305 slides:pick-picture-file).
    // There is no OS chooser in a lab, so the OPERATOR names the image (the server's
    // configured picturePickPath, or an explicit read-granted body.path) and this
    // channel does the REAL work the dialog's return value would trigger: a
    // read-granted file read of those exact bytes, answered in the preload's own
    // `{ base64, ext }` shape with ext lowercased the way slides-main.ts:2303 does.
    // An unarmed picker is the documented cancel: `null`, never a fabricated image.
    'host:slides-pick-picture-file': async (ctx, body) => {
      const requested = typeof body.path === 'string' && body.path.length > 0 ? body.path : picturePickPath;
      if (typeof requested !== 'string' || requested.length === 0) return null;
      const real = readGranted(ctx.session, requested);
      const ext = extname(real).replace(/^\./, '').toLowerCase();
      // The dialog's own filter list (slides-main.ts:2295). A pick outside it is
      // refused by name here, exactly as the native chooser would never offer it;
      // the ENGINE still decides format support downstream and answers the
      // { error: 'unsupported', ext } union member, which this lab preserves.
      if (!PICKABLE_PICTURE_EXTS.includes(ext)) {
        throw new LabProtocolError('not_an_image', 'the picked file is not a pickable image: ' + real);
      }
      const bytes = await readFileBytes(real);
      record({ view: ctx.viewId, op: 'slides-pick-picture-file', path: real, bytes: bytes.length });
      return { base64: bytes.toString('base64'), ext };
    },

    // The adapter already forwards host:slides-replace-picture-bytes
    // (host-adapter.mjs `replacePictureBytes`); only this server channel was missing.
    // The real engine route returns { ok, sourceId, slide } (engine-pptx-routes.mts
    // replacePictureBytes) and picture-edit-actions.ts `replacePicture` needs the
    // committed RenderSlide to hand to applySlide, or the named { error, ext } union
    // member. Anything else stays a named refusal, never a silent slide.
    'host:slides-replace-picture-bytes': async (ctx, body) => {
      const result = await engineCall(ctx.session, 'pptx-replace-picture', {
        viewId: ctx.viewId,
        slideIndex: body.slideIndex ?? body.slide ?? 0,
        sourceId: body.sourceId ?? body.el ?? null,
        base64: body.base64,
        ext: body.ext,
        ...(body.keepSrcRect === true ? { keepSrcRect: true } : {}),
      });
      if (result && typeof result === 'object' && result.ok === false && result.error === 'unsupported') {
        return { error: 'unsupported', ext: result.ext ?? body.ext };
      }
      if (!result || typeof result !== 'object' || result.ok !== true || !result.slide) {
        throw new LabProtocolError('replace_not_applied', 'pptx-replace-picture did not apply the replacement');
      }
      return result.slide;
    },

    'host:slides-txn': async (ctx, body) =>
      engineCall(ctx.session, 'pptx-txn', {
        sessionId: body.sessionId ?? null,
        ops: Array.isArray(body.ops) ? body.ops : [],
        viewId: ctx.viewId,
      }),

    'host:slides-save': async (ctx, body) => {
      // A caller cannot name a destination: only the server-derived target of THIS
      // view deck (never views/<id>/out, another view, or any lab path).
      const { name, target } = deckTargetFor(ctx, undefined);
      if (typeof body.targetPath === 'string' && body.targetPath !== target) {
        throw new LabProtocolError('wrong_view',
          'slides save target is not the output of this view deck: ' + String(body.targetPath));
      }
      return publishDeck(ctx, name, false);
    },

    'host:slides-save-as': async (ctx, body) => {
      if (typeof body.defaultName !== 'string' || body.defaultName.length === 0) {
        throw new LabProtocolError('invalid_input', 'slides save-as needs a defaultName');
      }
      // Save-as selects the next write file; the selected name becomes the saved
      // state only after the publication is proven.
      const { name, target } = deckTargetFor(ctx, body.defaultName);
      if (typeof body.targetPath === 'string' && body.targetPath !== target) {
        throw new LabProtocolError('wrong_view',
          'slides save-as target is not the output of this view deck: ' + String(body.targetPath));
      }
      return publishDeck(ctx, name, true);
    },

    'host:slides-recent': async () => ({ files: [] }),
  };

  // ── static renderer builds ────────────────────────────────────────────────

  const appOf = (urlPath) =>
    LAB_APPS.find((name) => urlPath === '/' + name || urlPath.startsWith('/' + name + '/')) ?? null;

  /**
   * The Vite builds reference `/assets/...` and `pdfjs/...` absolutely. Serving
   * each app under `/<app>/` therefore rewrites those bases to the app prefix.
   * The CSP meta tag, the module graph and every other byte are left untouched:
   * no `window.*Api` global is injected and the page's own CSP is preserved.
   */
  function rewriteAssetBase(html, app) {
    return html
      .replace(/(src|href)=("|')\/(?!\/)/g, (match, attr, quote) => attr + '=' + quote + '/' + app + '/')
      .replace(/url\((["']?)\//g, (match, quote) => 'url(' + quote + '/' + app + '/');
  }

  async function serveStatic(app, relPath, res, headOnly) {
    const base = join(roots.builds, app);
    const relative = relPath.replace(/^\/+/, '') || 'index.html';
    const target = join(base, relative);
    let real;
    try {
      real = roots.requireRead(target);
    } catch (error) {
      throw error;
    }
    let bytes;
    try {
      bytes = await readFileBytes(real);
    } catch (error) {
      if (error.code !== 'path_not_found') throw error;
      // A SPA deep link falls back to the app entry.
      bytes = await readFileBytes(roots.requireRead(join(base, 'index.html')));
      real = join(base, 'index.html');
    }
    const ext = extname(real).toLowerCase();
    const headers = {
      'content-type': mimeFor(real),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': appCsp(appOrigin, previewOrigin),

    };
    let body = ext === '.html' || ext === '.htm' ? rewriteAssetBase(bytes.toString('utf8'), app) : bytes;
    // ONLY the HTML app's own entry document pins the html-preview: frame-src
    // token, so only that one document is translated. The resolved path is
    // compared to the app entry by real path, using the same realpath
    // containment the rest of the lab uses, so a junction or a differently-cased
    // name cannot smuggle another file in and a missing deep link (the SPA
    // fallback above) is still recognized as the entry. Any other .html asset -
    // a second page, a fixture - is served with its own CSP untouched; it never
    // raises a translation error.
    const isAppEntry = realPathFor(real) === realPathFor(join(base, 'index.html'));
    if (app === 'html' && isAppEntry && typeof body === 'string') {
      body = translateHtmlPreviewFrameSrc(body, previewOrigin);
    }
    if (typeof body === 'string') {
      const encoded = Buffer.from(body, 'utf8');
      res.writeHead(200, Object.assign(headers, { 'content-length': encoded.length }));
      res.end(headOnly ? Buffer.alloc(0) : encoded);
      return;
    }
    res.writeHead(200, Object.assign(headers, { 'content-length': bytes.length }));
    res.end(headOnly ? Buffer.alloc(0) : bytes);
  }

  // ── JSON envelopes ────────────────────────────────────────────────────────

  function sendJson(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    res.writeHead(status, Object.assign({}, JSON_HEADERS, { 'content-length': body.length }));
    res.end(body);
  }

  const sendError = (res, error) => {
    const protocol =
      error instanceof LabProtocolError
        ? error
        : new LabProtocolError('internal_error', String((error && error.message) || error));
    sendJson(res, statusForCode(protocol.code), protocol.toEnvelope());
  };

  // ── preview listener (a separate origin) ─────────────────────────────────

  const respondPreview = createPreviewResponder({
    previews,
    sessions,
    labOrigin: appOrigin,
    previewOrigin,
  });

  const previewServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', previewOrigin);
      checkHost(req.headers.host, allowedHosts);
      checkOrigin(req.headers.origin, allowedOrigins);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new LabProtocolError('method_not_allowed', 'the preview surface is read-only');
      }
      if (url.pathname.startsWith('/lab')) {
        throw new LabProtocolError('unknown_channel', 'the preview origin serves no lab API');
      }
      const segments = url.pathname.replace(/^\/+/, '').split('/');
      const token = segments.shift();
      if (!token) throw new LabProtocolError('unknown_preview', 'a preview token is required');
      const result = await respondPreview(token, segments.join('/'));
      res.writeHead(result.status, Object.assign({ 'cache-control': 'no-store' }, result.headers));
      res.end(req.method === 'HEAD' ? Buffer.alloc(0) : result.body);
    } catch (error) {
      sendError(res, error);
    }
  });

  // ── app listener ─────────────────────────────────────────────────────────

  const appServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', appOrigin);
      checkHost(req.headers.host, allowedHosts);
      checkOrigin(req.headers.origin, allowedOrigins);

      // Original download: always available without the engine, and always the
      // immutable input the view was opened from - never the working copy, whose
      // bytes a save replaces. GET returns the bytes, HEAD the same headers with
      // no body, and every other method is refused.
      if (url.pathname.startsWith('/lab/original/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          throw new LabProtocolError('method_not_allowed', 'the original download is GET or HEAD only');
        }
        const viewId = decodeURIComponent(url.pathname.slice('/lab/original/'.length));
        const session = sessions.requireView(viewId);
        if (!session.sourceReal) {
          throw new LabProtocolError('path_not_found', 'this view has no opened original file');
        }
        // Realpath-verified and still covered by the view's own read grant, so a
        // known view id cannot read an arbitrary path through this route.
        const real = sessions.requireReadGrant(viewId, session.sourceReal);
        const bytes = await readFileBytes(real);
        const name = basename(real);
        res.writeHead(200, {
          'content-type': mimeFor(name),
          'content-length': bytes.length,
          'content-disposition': 'attachment; filename="' + name + '"',
          'cache-control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? Buffer.alloc(0) : bytes);
        return;
      }

      // View-scoped image assets. The authored Markdown keeps `assets/dot.png`,
      // and the pinned renderer's md-asset:// URL is mapped here instead, because
      // the app CSP is `img-src 'self'` and a custom scheme is blocked. The view id
      // is resolved to a real session before any path work, the relative path is
      // decoded into safe segments and resolved under that session's own granted
      // directory, and only a real image is served - never HTML/SVG, another
      // view's file, or an absolute/drive/UNC/traversal name.
      if (url.pathname.startsWith('/lab/asset/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          throw new LabProtocolError('method_not_allowed', 'the asset surface is GET or HEAD only');
        }
        const rest = url.pathname.slice('/lab/asset/'.length);
        const slash = rest.indexOf('/');
        if (slash < 0) {
          throw new LabProtocolError('path_required', 'an asset path is required after the view id');
        }
        const viewId = decodeURIComponent(rest.slice(0, slash));
        const relative = rest.slice(slash + 1);
        sessions.requireView(viewId);
        const real = sessions.requireReadAsset(viewId, relative);
        const mime = imageMimeFor(real);
        if (!mime) {
          throw new LabProtocolError('not_a_file', 'not a servable image: ' + relative);
        }
        const bytes = await readFileBytes(real);
        res.writeHead(200, {
          'content-type': mime,
          'content-length': bytes.length,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? Buffer.alloc(0) : bytes);
        return;
      }

      if (url.pathname === '/') {
        const list = LAB_APPS.map((app) => '<li><a href="/' + app + '/">/' + app + '/</a></li>').join('');
        const body = Buffer.from(
          '<!doctype html><meta charset=utf-8><title>DOC-003 lab</title><ul>' + list + '</ul>',
          'utf8',
        );
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length });
        res.end(req.method === 'HEAD' ? Buffer.alloc(0) : body);
        return;
      }

      // Browsers request this implicitly; the lab has no favicon asset.
      if (url.pathname === '/favicon.ico') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          throw new LabProtocolError('method_not_allowed', 'the favicon surface is GET or HEAD only');
        }
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
        return;
      }

      if (url.pathname === '/lab/bridge.js') {
        // The old lab injected a window.*Api proxy here. It is deliberately gone.
        throw new LabProtocolError(
          'unknown_channel',
          'the lab no longer injects renderer globals; the renderer host is imported explicitly',
        );
      }

      if (url.pathname.startsWith('/lab/')) {
        if (req.method !== 'POST') {
          throw new LabProtocolError('method_not_allowed', 'lab channels are POST-only');
        }
        const channel = decodeURIComponent(url.pathname.slice('/lab/'.length));
        const handler = handlers[channel];
        if (!handler) {
          throw new LabProtocolError('unknown_channel', 'no lab handler for ' + channel, { channel });
        }
        if (!isJsonContentType(req.headers['content-type'])) {
          throw new LabProtocolError(
            'unsupported_media_type',
            'lab channels require Content-Type: application/json',
            { contentType: req.headers['content-type'] ?? null },
          );
        }
        const raw = await readBoundedBody(req, maxBodyBytes);
        let body = {};
        if (raw.length > 0) {
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch {
            throw new LabProtocolError('invalid_json', 'request body is not valid JSON');
          }
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new LabProtocolError('invalid_json', 'request body must be a JSON object');
        }
        if (channel === 'lab:session-open') {
          sendJson(res, 200, { ok: true, result: await handler(controlCtx, body) });
          return;
        }
        // The view is resolved before the handler runs, so a forged path or an
        // unknown view id is a named error rather than a handler side effect.
        const session = sessions.requireView(body.viewId);
        // ...and the channel is authorized for that session's app before the
        // handler runs, so a view cannot call another app's channels.
        assertChannelApp(channel, session);
        // CONTRACT-v1: a declared bridge block is validated BEFORE the handler runs, so a missing or
        // unsupported contract string can never reach a write or an engine call. The request digest
        // and the observed User-Agent are frozen here and reused by the receipt.
        bridge.beginRequest({
          session,
          channel,
          body,
          userAgent: req.headers['user-agent'] ?? null,
          declared: body.bridge === undefined ? null : body.bridge,
        });
        const bridgeCall = bridge.beginCall(session.viewId, channel);
        let result;
        try {
          // The call token travels in AsyncLocalStorage, so an engine call made by THIS request is
          // attributed to THIS request even when two requests on one view overlap in time.
          result = await bridge.runWithCall(bridgeCall, () => handler(ctxOf(session), body));
        } finally {
          bridge.endCall(session.viewId, bridgeCall);
        }
        sendJson(res, 200, { ok: true, result: bridge.stampResult(channel, result, session) });
        return;
      }

      const app = appOf(url.pathname);
      if (!app) {
        throw new LabProtocolError('unknown_channel', 'not a lab route or a known app: ' + url.pathname);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new LabProtocolError('method_not_allowed', 'static builds are read-only');
      }
      await serveStatic(app, url.pathname.slice(app.length + 2), res, req.method === 'HEAD');
    } catch (error) {
      sendError(res, error);
    }
  });

  return {
    appServer,
    previewServer,
    roots,
    sessions,
    previews,
    events,
    engine,
    bridge,
    ports: { app: port, preview: previewPort },
    origins: { app: appOrigin, preview: previewOrigin },
    /** The channel names this server implements, for the report and tests. */
    channels: () => Object.keys(handlers).sort(),
    handlers,
    records: () => records.slice(),
    async listen() {
      await new Promise((ok, fail) => {
        appServer.once('error', fail);
        appServer.listen(port, '127.0.0.1', () => {
          appServer.removeListener('error', fail);
          ok();
        });
      });
      await new Promise((ok, fail) => {
        previewServer.once('error', fail);
        previewServer.listen(previewPort, '127.0.0.1', () => {
          previewServer.removeListener('error', fail);
          ok();
        });
      });
      return { app: appOrigin, preview: previewOrigin };
    },
    async close() {
      await Promise.all(
        [appServer, previewServer].map(
          (server) =>
            new Promise((ok) => {
              if (!server.listening) return ok();
              server.close(() => ok());
              server.closeAllConnections?.();
            }),
        ),
      );
    },
  };
}

/** Runs the server from the CLI; only called when this file is executed directly. */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgv(argv, env);
  const server = createLabServer({
    buildsDir: options.buildsDir,
    labDir: options.labDir,
    fixturesDir: options.fixturesDir,
    sourceDir: options.sourceDir,
    port: options.port,
    previewPort: options.previewPort,
    engineBaseUrl: options.engineBaseUrl,
    engineTimeoutMs: options.timeoutMs,
    maxBodyBytes: options.maxBodyBytes,
    fixtureManifest: options.fixtureManifest,
    fixtureRoot: options.fixtureRoot,
    bridgeReceipts: options.bridgeReceipts,
    orcaVersion: options.orcaVersion,
    orcaVersionSource: options.orcaVersionSource,
    sourcePin: options.sourcePin,
    sourceRoot: options.sourceDir,
    engineIdentity: options.engineIdentity,
  });
  const listening = await server.listen();
  const integrated = server.engine.integrated();
  process.stdout.write(
    'lab app on ' + listening.app + ' preview on ' + listening.preview +
      ' builds=' + options.buildsDir + ' lab=' + options.labDir +
      ' engine=' + (options.engineBaseUrl ?? 'unbound') +
      ' engineOperations=' + (integrated.length > 0 ? integrated.join(',') : 'none') +
      ' bridge=' + server.bridge.contract +
      ' bridgeManifest=' + (server.bridge.status().manifestPath ?? 'unbound') +
      ' bridgeReceipts=' + server.bridge.receiptsRoot +
      ' bridgeOrca=' + (server.bridge.status().orcaVersion ?? 'unavailable') +
      ' bridgeEngineIdentity=' + (server.bridge.status().engineIdentity ? server.bridge.status().engineIdentity.join(',') : 'unbound') + '\n',
  );
  const shutdown = () => server.close();
  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
  return server;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write('lab server failed: ' + String((error && error.stack) || error) + '\n');
    process.exitCode = 1;
  });
}

export { randomUUID };
