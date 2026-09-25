// DOC-003 lab engine proxy (UNI-667).
//
// Upstream editing needs a real Office engine. In the lab that engine is a
// second process (INT-01's "Office Engine Service" role); the lab server only
// ever forwards a *fixed, named* operation to it, never an arbitrary route the
// browser chose. This module is that forwarding boundary:
//
//   * the operation allowlist lives here, in the server, not in the request;
//   * the upstream call has a finite timeout and a real abort signal, so a hung
//     engine cannot hold a lab request open forever;
//   * the upstream response is validated (HTTP status, JSON content type, the
//     {ok,result|error} envelope, a bounded payload) before any of it is treated
//     as a result;
//   * when no engine operation is bound, the caller gets a named
//     `engine_unsupported` error. It is never answered with an empty or null
//     success, because a fake success is how a lab would claim a save it never
//     performed.
//
// A caller can also bind a function per operation. That is what the unit tests
// use, and it is also how main can wire an in-process adapter before the engine
// host exposes the matching route.
//
// Node 22 built-ins only. No production imports.

import { LabProtocolError } from './lab-storage.mjs';

/**
 * The complete set of engine operations the lab is allowed to ask for. An
 * operation is added here only when a real upstream callable exists for it, so
 * the list is also the honest statement of what is integrated.
 */
export const ENGINE_OPERATIONS = Object.freeze([
  'ping',
  'docx-parse',
  'docx-save',
  'pptx-open',
  'pptx-txn',
  'pptx-save',
  // S-OWNED EXTENSION (not in the frozen CONTRACT-v1 build): App.tsx onTransform ->
  // slidesApi.editTransform posts host:slides-edit-transform; the lab channel added by this patch
  // forwards it to the real /engine/pptx-edit-transform route, which the engine host advertises.
  'pptx-edit-transform',
  'pptx-edit-text',
  'pptx-is-dirty',
  // The renderer's new-slide picker mounts through host:slides-layouts; the real route below
  // serves the deck's own slideLayout catalog, so the operation is a real integrated binding.
  'pptx-layouts',
  // Picture Format > Replace Picture drives this through host:slides-replace-picture-bytes
  // (picture-edit-actions.ts replacePicture); engine-pptx-routes.mts serves
  // /engine/pptx-replace-picture from the real pptx-engine replacePictureBytes, so it is a
  // real integrated binding rather than an unknown_engine_operation.
  'pptx-replace-picture',
  'xlsx-open',
  'xlsx-recalc',
  // The renderer reads a range and the sheet's formulas on mount and on every edit; the engine
  // host serves /engine/xlsx-read-range and /engine/xlsx-read-formulas and the accepted XLSX
  // bridge now binds both, so these reads are real integrated operations rather than the
  // unknown_engine_operation the unbound lab used to answer.
  'xlsx-read-range',
  'xlsx-read-formulas',
  'xlsx-save',
  // The renderer closes the workbook it opened (App.tsx:2850 -> desktopApi.closeWorkbook), and the
  // real engine host serves /engine/xlsx-close, so this is an honest integrated operation rather
  // than the engine_unsupported 501 the page used to absorb. /engine/xlsx-is-dirty also exists but
  // has NO consumer in this lane (the sheets surface declares no isDirty member), so it stays
  // unbound: the allowlist states exactly what is integrated, never a surface nobody calls.
  'xlsx-close',
  'pdf-read',
  'pdf-validate-text-edits',
  'pdf-list-page-images',
  'pdf-list-static-form-fills',
  'pdf-edit-fonts',
  'pdf-can-draw-text',
  'pdf-save',
]);

export class EngineUnsupportedError extends LabProtocolError {
  constructor(operation, detail) {
    super(
      'engine_unsupported',
      'no engine operation is bound for "' + operation + '"' + (detail ? ': ' + detail : ''),
      { operation, integrated: false },
    );
    this.name = 'EngineUnsupportedError';
    this.operation = operation;
  }
}

/** A JSON body larger than this is refused rather than buffered. */
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

const isJsonContentType = (value) =>
  typeof value === 'string' && /^\s*application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(value);

/**
 * Builds the engine proxy.
 *
 * @param {object} options
 * @param {string|null} options.baseUrl        engine host origin, e.g. http://127.0.0.1:5391
 * @param {number} options.timeoutMs           hard per-operation deadline
 * @param {number} options.maxResponseBytes    payload cap for the upstream reply
 * @param {Function} options.fetchImpl         injectable fetch (tests, or a host shim)
 * @param {object} options.handlers            operation name -> function(input) | route string
 */
export function createEngineProxy({
  baseUrl = null,
  timeoutMs = 15000,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  fetchImpl = null,
  handlers = {},
  operations = ENGINE_OPERATIONS,
} = {}) {
  const allowed = new Set(operations);
  const bound = new Map();
  for (const [name, handler] of Object.entries(handlers)) {
    if (!allowed.has(name)) {
      throw new Error('engine proxy: "' + name + '" is not a permitted engine operation');
    }
    bound.set(name, handler);
  }
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);

  /** True when this operation has a real binding and can actually run. */
  const has = (name) => bound.has(name);

  /** The operations with a binding; the rest are reported as unsupported. */
  const integrated = () => [...bound.keys()].sort();

  const unsupported = () => operations.filter((name) => !bound.has(name));

  async function callHttp(name, input, viewId) {
    if (!baseUrl) {
      throw new EngineUnsupportedError(name, 'no engine host base URL is configured');
    }
    if (!doFetch) {
      throw new EngineUnsupportedError(name, 'no fetch implementation is available');
    }
    // The route is the server-owned operation name, never a URL from the caller.
    const route = typeof bound.get(name) === 'string' ? bound.get(name) : name;
    const url = String(baseUrl).replace(/\/+$/, '') + '/engine/' + route;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('lab engine deadline exceeded')), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    let response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-lab-view': String(viewId ?? ''),
        },
        body: JSON.stringify(input ?? {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LabProtocolError(
          'engine_timeout',
          'engine operation "' + name + '" exceeded its ' + timeoutMs + 'ms deadline',
          { operation: name, timeoutMs },
        );
      }
      throw new LabProtocolError(
        'engine_unreachable',
        'engine host is unreachable for "' + name + '": ' + String(error.message ?? error),
        { operation: name },
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status !== 200) {
      throw new LabProtocolError(
        'engine_http_error',
        'engine host returned HTTP ' + response.status + ' for "' + name + '"',
        { operation: name, upstreamStatus: response.status },
      );
    }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw new LabProtocolError(
        'engine_invalid_response',
        'engine host did not answer "' + name + '" with JSON',
        { operation: name, contentType: response.headers.get('content-type') ?? null },
      );
    }

    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > maxResponseBytes) {
      throw new LabProtocolError(
        'engine_response_too_large',
        'engine reply for "' + name + '" is ' + raw.length + ' bytes, over the ' +
          maxResponseBytes + '-byte cap',
        { operation: name, bytes: raw.length },
      );
    }
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      throw new LabProtocolError(
        'engine_invalid_response',
        'engine reply for "' + name + '" is not valid JSON',
        { operation: name },
      );
    }
    if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean') {
      throw new LabProtocolError(
        'engine_invalid_response',
        'engine reply for "' + name + '" is missing the {ok,result|error} envelope',
        { operation: name },
      );
    }
    if (body.ok === false) {
      throw new LabProtocolError(
        'engine_error',
        'engine rejected "' + name + '": ' + String(body.error ?? 'unknown engine error'),
        { operation: name },
      );
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'result')) {
      throw new LabProtocolError(
        'engine_invalid_response',
        'engine reply for "' + name + '" has ok:true but no result',
        { operation: name },
      );
    }
    return body.result;
  }

  /**
   * Runs one engine operation. `viewId` is passed by the trusted server handler
   * from the session, never from the request body, and is forwarded upstream as
   * the lab view identity.
   */
  async function call(name, input, { viewId = null } = {}) {
    if (!allowed.has(name)) {
      throw new LabProtocolError(
        'unknown_engine_operation',
        'not a permitted lab engine operation: ' + String(name),
      );
    }
    if (!bound.has(name)) {
      throw new EngineUnsupportedError(
        name,
        'the engine worker has not supplied this mapping yet; the lab reports it as unsupported ' +
          'instead of returning an empty result',
      );
    }
    const handler = bound.get(name);
    if (typeof handler === 'function') {
      return handler(input, { viewId });
    }
    return callHttp(name, input, viewId);
  }

  return {
    call,
    has,
    integrated,
    unsupported,
    /** The allowlist itself, for the report and for tests. */
    operations: () => operations.slice(),
    timeoutMs,
    maxResponseBytes,
    baseUrl,
  };
}

/**
 * Strict base64 validation for byte payloads. `Buffer.from(s,'base64')` silently
 * drops invalid characters, which is exactly how a malformed save would become a
 * short or empty write, so the shape is checked before decoding.
 */
export function decodeBase64Strict(value, { field = 'dataBase64', maxBytes = 64 * 1024 * 1024 } = {}) {
  if (typeof value !== 'string') {
    throw new LabProtocolError('invalid_base64', field + ' must be a base64 string');
  }
  const compact = value.replace(/\s+/g, '');
  if (compact.length === 0) return Buffer.alloc(0);
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new LabProtocolError('invalid_base64', field + ' is not canonical base64');
  }
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  const expectedBytes = (compact.length / 4) * 3 - padding;
  if (expectedBytes > maxBytes) {
    throw new LabProtocolError(
      'payload_too_large',
      field + ' decodes to ' + expectedBytes + ' bytes, over the ' + maxBytes + '-byte cap',
    );
  }
  const decoded = Buffer.from(compact, 'base64');
  if (decoded.length !== expectedBytes) {
    throw new LabProtocolError('invalid_base64', field + ' did not decode to its declared length');
  }
  return decoded;
}

/**
 * Empty-byte policy. Formats with a required binary body (a zip container, a PDF,
 * an image) cannot be empty; authored text can be empty because empty is a real
 * serialization the user asked to save.
 */
export const BYTE_FORMATS = Object.freeze([
  { ext: '.docx', emptyAllowed: false },
  { ext: '.docm', emptyAllowed: false },
  { ext: '.xlsx', emptyAllowed: false },
  { ext: '.xlsm', emptyAllowed: false },
  { ext: '.pptx', emptyAllowed: false },
  { ext: '.pdf', emptyAllowed: false },
  { ext: '.png', emptyAllowed: false },
  { ext: '.jpg', emptyAllowed: false },
  { ext: '.jpeg', emptyAllowed: false },
  { ext: '.gif', emptyAllowed: false },
  { ext: '.webp', emptyAllowed: false },
  { ext: '.md', emptyAllowed: true },
  { ext: '.markdown', emptyAllowed: true },
  { ext: '.html', emptyAllowed: true },
  { ext: '.htm', emptyAllowed: true },
  { ext: '.txt', emptyAllowed: true },
  { ext: '.csv', emptyAllowed: true },
  { ext: '.json', emptyAllowed: true },
]);

/** The byte policy for a file name, defaulting to "empty is not allowed". */
export function byteFormatFor(fileName) {
  const name = String(fileName ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot);
  return BYTE_FORMATS.find((entry) => entry.ext === ext) ?? { ext, emptyAllowed: false };
}

/** Refuses an empty byte save where the format forbids it. */
export function assertNonEmptyBytes(bytes, fileName) {
  const policy = byteFormatFor(fileName);
  if (bytes.length === 0 && policy.emptyAllowed === false) {
    throw new LabProtocolError(
      'empty_output_refused',
      'refusing to write an empty ' + (policy.ext || 'binary') + ' file: the format cannot be empty',
      { ext: policy.ext },
    );
  }
  return bytes;
}
