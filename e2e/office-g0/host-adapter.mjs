// DOC-003 lab host adapter (UNI-667): the explicit browser host that replaces the
// Electron preload globals inside the prepared GenOffice renderers.
//
// What this is
// ------------
// Every GenOffice renderer expects a preload object reachable through window
// (desktop, desktopApi, markdownApi, htmlApi, pdfApi, slidesApi, projectApi,
// filesPaneApi). In the lab those globals do not exist: the renderer source is
// rewritten to read the imported host accessor instead (see source-transform.mjs)
// and this module builds that host. Every method is either a real implementation
// over the lab transport or an explicit unsupported path that fails with a
// HostCapabilityError. There is deliberately no Proxy and no fallback that answers
// null, {}, false or a no-op for a call the lab cannot honour, because a silent
// null is exactly how a lab would fake a passing save. A method whose upstream
// contract returns a Promise reports that same typed failure as a rejection (see
// UNSUPPORTED_REJECTING_METHODS) so the caller's own `.catch` handles it; every
// other unsupported method still throws synchronously at the call site.
//
// Session and identity
// --------------------
// The view id is minted by the lab server, never by the page: the page sends an
// unauthenticated lab-control POST to /lab/lab:session-open with { app, path } and
// receives { viewId, app, path, name, hash }. Only then does the transport accept
// calls, and every later call carries that server-issued viewId, written last so a
// caller payload can never override it.
//
// Byte shapes are the contract
// ----------------------------
// The renderer code is untouched apart from the window->host rewrite, so every
// value must match the preload exactly:
//   * docs open           -> { path, name, data: ArrayBuffer, hash }
//   * pdf readFile        -> ArrayBuffer
//   * markdown/html read  -> string (UTF-8); save -> SaveMarkdownRequest/SaveHtmlRequest
//   * pdf save            -> the real SavePdfRequest forwarded unchanged
//   * sheets/slides save  -> the real request objects forwarded unchanged
// decodePayload therefore preserves primitives, arrays and null instead of
// coercing a string result into an object keyed by character index.
//
// Lab scope, stated honestly
// --------------------------
// This is a lab transport over the /lab/<channel> JSON surface. It proves nothing
// about production auth, tenancy or permissions. AI, cloud, attachment, print,
// export and shell-chrome surfaces are out of the G0 six-editor cycle and fail
// with HostCapabilityError instead of pretending to work; the report that ships
// with this module lists the channels a server implementation still has to provide.
// A caught HostCapabilityError is not a working AI status or a completed operation:
// nothing here reports a logged-in account, a fabricated result or a faked save.

import { HOST_SURFACE, globalsForApp } from './host-surface.mjs';

/** Thrown when a renderer calls a host method the lab deliberately does not implement. */
export class HostCapabilityError extends Error {
  constructor(method, detail) {
    super('lab host has no implementation for ' + method + (detail ? ' (' + detail + ')' : ''));
    this.name = 'HostCapabilityError';
    this.method = method;
  }
}

/** Thrown when the lab channel itself fails; distinct from a missing capability. */
export class LabChannelError extends Error {
  constructor(channel, detail) {
    super('lab channel ' + channel + ' failed: ' + detail);
    this.name = 'LabChannelError';
    this.channel = channel;
  }
}

/** The channel that mints the server-side view id; the only call made without one. */
export const SESSION_OPEN_CHANNEL = 'lab:session-open';

/**
 * Globals declared on Window by the pinned renderer env.d.ts that the window-read
 * scan cannot see (they are read through a `window as ...` cast), so the adapter
 * still has to give them an explicit, loud surface instead of `undefined`.
 */
export const AUX_METHODS = {
  projectApi: ['resolveChat', 'appendChat', 'loadChat', 'rebindChat'],
  filesPaneApi: [
    'folderRoot',
    'listFolder',
    'createFolder',
    'renameFolder',
    'renameFile',
    'movePaths',
    'deleteFolder',
    'deleteFiles',
    'openPath',
    'revealPath',
    'onFolderChanged',
  ],
};

/** One-way reports that the renderer sends; the lab records them instead of dropping them. */
export const RECORDED_REPORTS = {
  setDirty: 'dirty',
  notifyPendingEdits: 'pendingEdits',
  sendCloseSaveResult: 'closeSaveResults',
  reportCloseSaveResult: 'closeSaveResults',
  sendSaveRequestAck: 'saveAcks',
  headlessExportDone: 'headlessExport',
  setProvisionalTitle: 'provisionalTitle',
};

/* ------------------------------------------------------------------ base64 ---- */

/** Base64 -> ArrayBuffer, byte for byte (never a Node Buffer, always a real ArrayBuffer). */
export function decodeBase64Buffer(base64) {
  const binary = atob(String(base64 ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** ArrayBuffer / typed array -> base64, chunked so a large fixture does not blow the stack. */
export function encodeBufferBase64(value) {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const isBinary = (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value);

/**
 * JSON-safe form of one value: binary becomes { __bytesBase64 }, everything else
 * keeps its own type so a string, number, boolean, null or array stays itself.
 */
function encodeValue(value) {
  if (value === undefined) return undefined;
  if (isBinary(value)) return { __bytesBase64: encodeBufferBase64(value) };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = encodeValue(value[key]);
    return out;
  }
  return value;
}

/** Inverse of encodeValue; only values that arrived as { __bytesBase64 } become ArrayBuffers. */
function decodeValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (isBinary(value)) return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  if (typeof value.__bytesBase64 === 'string') return decodeBase64Buffer(value.__bytesBase64);
  const out = {};
  for (const key of Object.keys(value)) out[key] = decodeValue(value[key]);
  return out;
}

/** Request payload -> JSON body fields. Primitives and shapes are preserved. */
export function encodePayload(payload) {
  const out = {};
  for (const key of Object.keys(payload ?? {})) {
    const value = encodeValue(payload[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Channel result -> renderer value. A string result stays a string; null stays null. */
export function decodePayload(result) {
  if (result === undefined) return null;
  return decodeValue(result);
}

/* ---------------------------------------------------------------- transport ---- */

/**
 * JSON transport over the existing /lab/<channel> surface.
 *
 * A caller payload may never carry viewId: the trusted, server-issued value is
 * written last, and a payload that tries to set it is rejected outright rather
 * than silently overridden.
 */
export function createLabTransport({ baseUrl = '', fetchImpl } = {}) {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('lab host: no fetch implementation is available');
  let viewId = null;
  // Every authorized call of one view runs through this FIFO queue. Upstream the
  // preview push is fire-and-forget (`void htmlApi.updatePreview(...)` immediately
  // before the frame is pointed at the URL), which over HTTP would let a stale GET
  // win. Ordering the calls per view is the host-side equivalent of an awaited
  // flush: the read that follows a push is necessarily sent after the push stored
  // its version, so the frame can never receive content older than the last edit.
  let queue = Promise.resolve();

  const post = async (channel, body) => {
    const response = await doFetch(baseUrl + '/lab/' + channel, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      throw new LabChannelError(channel, 'the lab returned a non-JSON body (HTTP ' + response.status + ')');
    }
    if (!response.ok || !parsed || parsed.ok !== true) {
      const code = (parsed && parsed.error) || 'HTTP ' + response.status;
      // DOC-003 r2 named refusal: keep the server's named detail beside the code.
      const detail = parsed && typeof parsed.message === 'string' && parsed.message.length > 0 ? code + ': ' + parsed.message : code;
      throw new LabChannelError(channel, detail);
    }
    return decodePayload(parsed.result);
  };

  return {
    get viewId() {
      return viewId;
    },
    /** Installs the server-issued view id; only the session bootstrap may call this. */
    setSession(id) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new LabChannelError(SESSION_OPEN_CHANNEL, 'the lab did not return a viewId');
      }
      viewId = id;
      return viewId;
    },
    /**
     * Opens the per-page session against the server. This is the one call made
     * without a view id, and it is what authorizes every later call.
     */
    async openSession({ app, path: fixture = null } = {}) {
      if (!app) throw new Error('lab host: session-open needs the app name');
      const result = await post(SESSION_OPEN_CHANNEL, { app, path: fixture });
      if (!result || typeof result !== 'object') {
        throw new LabChannelError(SESSION_OPEN_CHANNEL, 'the lab returned no session object');
      }
      this.setSession(result.viewId);
      return result;
    },
    /** One authorized channel call, ordered behind every earlier call of this view. */
    call(channel, payload = {}) {
      if (viewId === null) {
        return Promise.reject(
          new LabChannelError(
            channel,
            'no session is open; the page bootstrap must call lab:session-open before the app entry is imported',
          ),
        );
      }
      if (payload && typeof payload === 'object' && payload.viewId !== undefined) {
        return Promise.reject(
          new LabChannelError(channel, 'the caller payload must not carry viewId; the session id is owned by the transport'),
        );
      }
      const body = encodePayload(payload);
      body.viewId = viewId;
      const ordered = queue.then(() => post(channel, body));
      // Keep the chain alive after a rejection so one failed call cannot deadlock
      // every later call of the same view.
      queue = ordered.then(
        () => undefined,
        () => undefined,
      );
      return ordered;
    },
  };
}

/* -------------------------------------------------------------- preferences ---- */

/** Real preference and event state: it stores values and it notifies listeners. */
export function createHostPreferences(initial = {}) {
  const listeners = new Map();
  const state = {
    language: initial.language ?? 'en',
    theme: initial.theme ?? 'light',
    autoSave: initial.autoSave ?? { on: false, updatedAt: 0 },
    aiPanelPrefs: initial.aiPanelPrefs ?? {},
  };
  const on = (event, handler) => {
    if (typeof handler !== 'function') {
      throw new Error('lab host: subscription ' + event + ' needs a handler function');
    }
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  };
  const emit = (event, value) => {
    const set = listeners.get(event);
    if (!set) return 0;
    for (const handler of set) handler(value);
    return set.size;
  };
  return {
    on,
    emit,
    get language() {
      return state.language;
    },
    get theme() {
      return state.theme;
    },
    get autoSave() {
      return { ...state.autoSave };
    },
    get aiPanelPrefs() {
      return { ...state.aiPanelPrefs };
    },
    setTheme(theme) {
      state.theme = theme;
      emit('themeChanged', theme);
    },
    setLanguage(language) {
      state.language = language;
      emit('languageChanged', language);
    },
    setAutoSave(autoSave) {
      state.autoSave = autoSave;
      emit('autoSaveDefaultChanged', autoSave);
    },
    setAiPanelPrefs(prefs) {
      state.aiPanelPrefs = prefs;
      emit('aiPanelPrefsChanged', prefs);
    },
  };
}

/* ----------------------------------------------------- unsupported plumbing ---- */

/** A throwing placeholder is marked so the capability report separates it from a real call. */
function unsupported(globalName, method, detail) {
  const fail = () => {
    throw new HostCapabilityError(globalName + '.' + method, detail);
  };
  fail.throwsOnCall = true;
  fail.method = globalName + '.' + method;
  return fail;
}

/**
 * The declared methods whose upstream contract returns a Promise AND whose frozen
 * renderer invocation is an unguarded `.then(...).catch(...)` chain at mount. A
 * synchronous throw escapes React's effect instead of being handled by that
 * `.catch`, so the mount aborts; delivering the same HostCapabilityError as a
 * rejection keeps the unsupported semantics truthful and lets the caller's own
 * error path run.
 *
 * This is an explicit allowlist, not "everything async":
 *   * markdownApi.aiGskStatus - AiPanel.tsx:194-199, markdown shared/ipc.ts:205
 *   * projectApi.resolveChat / loadChat - AiPanel.tsx:484-519, project-store ipc.ts:72/:76
 *   * desktop.aiGskStatus (docs only) - AiPanel.tsx:481-486
 * A method left off it keeps the synchronous throw, so a void report
 * (markdownApi.sendReadTextResult) or a synchronous call (htmlApi.getPathForFile)
 * still fails loudly at its own call site. projectApi.appendChat is Promise-shaped
 * upstream but is only reached on an AI send (AiPanel.tsx:256), which stays
 * outside G0. projectApi.rebindChat is also Promise-shaped, and its first-save
 * rebind path (AiPanel.tsx:527-535) belongs to the G0 save-reopen flow, but it is
 * currently unreachable: projectApi.resolveChat rejects, so no chat ids ever bind,
 * chatIdsRef stays null and the rebind effect returns early before it can call
 * rebindChat. appendChat and rebindChat therefore keep their synchronous throw for
 * now and are reported separately.
 */
export const UNSUPPORTED_REJECTING_METHODS = {
  // pdfApi.gskStatus - pdf renderer AiPanel.tsx:255-265 is
  // void window.pdfApi?.gskStatus().then(...).catch(...) inside a mount effect that has no
  // try/catch, so a synchronous throw escapes the effect and aborts the PDF mount. Same class
  // as docs.desktop.aiGskStatus; the rejection keeps gskLoggedInRef false, so no login is faked.
  pdfApi: ['gskStatus'],
  markdownApi: ['aiGskStatus'],
  projectApi: ['resolveChat', 'loadChat'],
  // slidesApi.aiGskStatus - AiPanel.tsx:531-535 and :1485 invoke it as an unguarded
  // '.catch(() => {})'; the rejection keeps gskLoggedInRef false, so no login is faked.
  slidesApi: ['aiGskStatus'],
  // docs.desktop.aiGskStatus - AiPanel.tsx:481-486 (`.then(...).catch(...)`); the
  // rejection keeps gskLoggedInRef false, so no login is faked.
  // docs.desktop.respellKick (App.tsx:1394-1396) is deliberately NOT listed: it is only
  // reached on the spellcheck off->on toggle, which this cycle never performs, so it keeps
  // its historical synchronous-unsupported behavior unchanged (correction THREE/r4).
  // Only the docs `desktop` global declares aiGskStatus here; no other app gains an entry.
  desktop: ['aiGskStatus'],
  // sheets.desktopApi.aiGskStatus - the sheets renderer App.tsx:853-869 is
  // void window.desktopApi?.aiGskStatus().then(...).catch(() => {}) inside a mount effect
  // with no try/catch. The optional chain only guards a MISSING global and the lab DOES
  // install desktopApi, so the synchronous stub throw escapes the effect before the
  // promise's .catch can attach. This map is keyed by GLOBAL name; only the sheets surface
  // declares a desktopApi global (host-surface.mjs:246, pinned by the sheets guard test),
  // so the entry is sheets-only in practice. The rejection keeps gskLoggedInRef false, so
  // no login is faked.
  desktopApi: ['aiGskStatus'],
};

/**
 * An unsupported method whose upstream contract returns a Promise. The
 * HostCapabilityError is delivered by a rejection (never a resolved value), so the
 * caller's `.then` never runs as if the capability existed and its `.catch` sees
 * the real failure. The rejection is created at call time, so an imported but
 * never-called method cannot raise an unhandled rejection.
 */
function unsupportedRejecting(globalName, method, detail) {
  const fail = () => Promise.reject(new HostCapabilityError(globalName + '.' + method, detail));
  fail.rejectsOnCall = true;
  fail.throwsOnCall = false;
  fail.method = globalName + '.' + method;
  return fail;
}

/* ------------------------------------------------------------ implementations ---- */

/**
 * Canonical event name for an `on*` handler, so a local subscription and a real
 * server push agree on the key: onThemeChanged and a pushed theme-change event both
 * land in `themeChanged`.
 */
export const eventNameFor = (method) =>
  /^on[A-Z]/.test(method) ? method.slice(2, 3).toLowerCase() + method.slice(3) : method;

/** The preference / theme / language surface every editor shares. */
function commonApi(state) {
  return {
    getLanguage: async () => state.language,
    onLanguageChanged: (handler) => state.on(eventNameFor('onLanguageChanged'), handler),
    getTheme: async () => state.theme,
    onThemeChanged: (handler) => state.on(eventNameFor('onThemeChanged'), handler),
    getAutoSaveDefault: async () => state.autoSave,
    onAutoSaveDefaultChanged: (handler) => state.on(eventNameFor('onAutoSaveDefaultChanged'), handler),
    getAiPanelPrefs: async () => state.aiPanelPrefs,
    onAiPanelPrefsChanged: (handler) => state.on(eventNameFor('onAiPanelPrefsChanged'), handler),
    onChromePressed: (handler) => state.on(eventNameFor('onChromePressed'), handler),
  };
}

/**
 * One-way reports. They are void upstream, so the adapter forwards each to the
 * owning view's channel without blocking the renderer, but a transport failure is
 * caught and recorded as a host failure while the local state is preserved: a save
 * or close that did not reach the server is never reported as acknowledged.
 */
function recordedReports(reports, state, send) {
  return {
    setDirty: (dirty) => {
      reports.dirty = dirty === true;
      state.emit(eventNameFor('onDirty'), reports.dirty);
      send('host:dirty', { dirty: reports.dirty });
    },
    notifyPendingEdits: (count) => {
      reports.pendingEdits = Number(count) || 0;
      send('host:pending-edits', { count: reports.pendingEdits });
    },
    sendCloseSaveResult: (ok) => {
      send('host:close-save-result', { ok: ok === true });
    },
    reportCloseSaveResult: (ok) => {
      send('host:close-save-result', { ok: ok === true });
    },
    sendSaveRequestAck: (ok) => {
      send('host:save-ack', { ok: ok === true });
    },
    headlessExportDone: (result) => {
      reports.headlessExport.push(result ?? null);
      send('host:headless-export-done', { result: result ?? null });
    },
    setProvisionalTitle: (title) => {
      reports.provisionalTitle = String(title ?? '');
    },
    setAutoSavePref: (on) => {
      state.setAutoSave({ on: on === true, updatedAt: 0 });
      send('host:autosave-pref', { on: on === true });
    },
  };
}

const asBase64 = (value, channel) => {
  if (!isBinary(value)) {
    throw new LabChannelError(channel, 'the request needs the real bytes, not ' + typeof value);
  }
  return encodeBufferBase64(value);
};

/**
 * Reads a flag the renderer expects as a bare boolean. The lab server may answer
 * either a bare boolean or the object its handler built; both are accepted, and
 * anything else is a contract error rather than a silent false.
 */
const flagOf = (result, key, channel) => {
  if (typeof result === 'boolean') return result;
  if (result && typeof result === 'object' && typeof result[key] === 'boolean') return result[key];
  throw new LabChannelError(channel, 'expected a boolean result (or ' + JSON.stringify(key) + ')');
};

/** Renders the open result the renderer's own type expects, or null when there is none. */
const openResultOf = (result, channel) => {
  if (result === null) return null;
  if (!result || typeof result !== 'object' || typeof result.path !== 'string' || !Array.isArray(result.slides)) {
    throw new LabChannelError(channel, 'expected an OpenResult with path and slides');
  }
  return result;
};

/** A Promise returned as-is, so a caller awaiting it can never observe undefined. */
const forward = (call, channel, payload) => call(channel, payload);

/* ------------------------------------------------------------ docs mount truth ---- */

/**
 * The pinned docs surface has two mount reads and one effect read the renderer performs
 * WITHOUT a .catch (App.tsx:1227-1230 and App.tsx:1574-1576). An unsupported synchronous
 * throw therefore aborts the React mount and the editor never appears - the observed r1
 * failure of the DOCX cycle.
 *
 * The two values here are explicit LAB SEMANTICS, not renderer behaviour:
 *   * the lab keeps no recent-files store, so the truthful answer is the empty list
 *     (same shape and meaning as the slides host's empty recents);
 *   * the lab keeps no AI settings store and holds no credentials, so the truthful
 *     answer is the pinned docs renderer DEFAULT_SETTINGS shape (App.tsx:567-575):
 *     provider 'anthropic', every AI_PROVIDERS id present, apiKey '', model = that
 *     provider's pinned defaultModel, baseUrl '' only where needsBaseUrl holds.
 *     `gskToolsEnabled`, `media` and `search` are omitted: their absence is the pinned
 *     default, and an explicit cloud-tools opt-out would assert a user choice that was
 *     never made. No model id is invented: DOCS_AI_PROVIDERS mirrors the pinned
 *     AI_PROVIDERS metadata and the guard test pins it.
 *
 * Nothing here makes an AI operation succeed: aiStream, aiGskLogin, aiGskStatus,
 * webSearch, imageSearch, aiGenerateImage and setAiSettings keep failing loudly, so the
 * lab cannot return AI output, a login state or persisted settings.
 */
export const DOCS_AI_PROVIDERS = Object.freeze([
  // Snapshot of packages/ai-provider/src/providers.ts AI_PROVIDERS (lines 42-267) at
  // pinned commit 09485f884dc845cf3bf27fb7edfe489f9d457aad.
  { id: 'uniai', defaultModel: 'claude-opus-4-7', needsBaseUrl: false, needsCliPath: false },
  { id: 'codex', defaultModel: '', needsBaseUrl: false, needsCliPath: true },
  { id: 'anthropic', defaultModel: 'claude-sonnet-5', needsBaseUrl: false, needsCliPath: false },
  { id: 'gemini', defaultModel: 'gemini-3.7-flash', needsBaseUrl: false, needsCliPath: false },
  { id: 'deepseek', defaultModel: 'deepseek-v4-pro', needsBaseUrl: false, needsCliPath: false },
  { id: 'openai', defaultModel: 'gpt-5.6-terra', needsBaseUrl: false, needsCliPath: false },
  { id: 'kimi', defaultModel: 'kimi-k3', needsBaseUrl: false, needsCliPath: false },
  { id: 'glm', defaultModel: 'glm-5.3', needsBaseUrl: false, needsCliPath: false },
  { id: 'qwen', defaultModel: 'qwen3.8-max', needsBaseUrl: false, needsCliPath: false },
  { id: 'doubao', defaultModel: 'doubao-seed-2-1-pro-260628', needsBaseUrl: false, needsCliPath: false },
  { id: 'minimax', defaultModel: 'MiniMax-M3', needsBaseUrl: false, needsCliPath: false },
  { id: 'xai', defaultModel: 'grok-4.6', needsBaseUrl: false, needsCliPath: false },
  { id: 'mistral', defaultModel: 'mistral-medium-latest', needsBaseUrl: false, needsCliPath: false },
  { id: 'openrouter', defaultModel: 'openrouter/auto', needsBaseUrl: false, needsCliPath: false },
  { id: 'requesty', defaultModel: 'claude-sonnet-5', needsBaseUrl: false, needsCliPath: false },
  { id: 'opencode-zen', defaultModel: 'claude-sonnet-5', needsBaseUrl: false, needsCliPath: false },
  { id: 'opencode-go', defaultModel: 'kimi-k2.7-code', needsBaseUrl: false, needsCliPath: false },
  { id: 'custom', defaultModel: '', needsBaseUrl: true, needsCliPath: false },
]);

export const DOCS_AI_PROVIDER_IDS = Object.freeze(DOCS_AI_PROVIDERS.map((meta) => meta.id));

/**
 * A fresh, unconfigured value in the pinned docs App DEFAULT_SETTINGS shape. A new
 * object and a new providers map per call: no view, test or app shares mutable state.
 */
export function labDocsAiSettings() {
  const providers = {};
  for (const meta of DOCS_AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: '',
      model: meta.defaultModel,
      baseUrl: meta.needsBaseUrl ? '' : undefined,
    };
  }
  return { provider: 'anthropic', providers };
}

/**
 * Builds the per-global implementations for one app. Only the methods listed here
 * are real; every other method the pinned renderer reads becomes an explicit
 * HostCapabilityError, and every `on*` method becomes a real subscription on the
 * lab event bus (it registers a handler and returns a real unsubscribe).
 */
function buildImplementations({ app, call, send, state, view, reports, sessionId }) {
  const common = commonApi(state);
  const recorded = recordedReports(reports, state, send);

  const textRead = async (path) => {
    const result = await call('host:text-read', { path: String(path ?? '') });
    if (typeof result !== 'string') {
      throw new LabChannelError('host:text-read', 'expected the UTF-8 text as a bare string result');
    }
    return result;
  };

  const textSave = (request, ext) => {
    if (!request || typeof request !== 'object' || typeof request.text !== 'string') {
      throw new HostCapabilityError(app + ' save', 'a SaveMarkdownRequest/SaveHtmlRequest with text is required');
    }
    return call('host:text-save', { ext, ...request });
  };

  const textConsumePending = async () => {
    const result = await call('host:text-consume-pending', {});
    if (typeof result !== 'string' || result.length === 0) return null;
    view.path = result;
    return result;
  };

  /**
   * The PDF app pending-open channel. host:text-* belongs to markdown/html
   * (lab-server.mjs:190,:214) and a PDF view posting it is refused 403 wrong_view before any
   * handler runs (:237-244), so the PDF app must use its own channel, which the lab server
   * already implements as host:pdf-consume-pending (:679-683).
   */
  const pdfConsumePending = async () => {
    const result = await call('host:pdf-consume-pending', {});
    if (typeof result !== 'string' || result.length === 0) return null;
    view.path = result;
    return result;
  };

  /* Image and asset operations. They are real calls; a picker cancel comes back as
     the documented null, never a simulated success path. */
  const readImage = async (src) => forward(call, 'host:image-read', { src: String(src ?? '') });
  const saveImage = async (data) => forward(call, 'host:image-save', { ...(data ?? {}) });
  const saveImageAs = async (src) => forward(call, 'host:image-save-as', { src: String(src ?? '') });
  const pickImage = async () => forward(call, 'host:image-pick', {});

  const docsEntry = (result, channel) => {
    if (!result) return null;
    // DOC-003 r2 password: an encrypted package comes back as the desktop OpenDocxResult
    // { needsPassword, path, name }; loadFile then opens the renderer password prompt.
    if (result.needsPassword === true) {
      view.path = result.path;
      view.name = result.name ?? null;
      return { needsPassword: true, path: result.path, name: result.name };
    }
    if (typeof result.dataBase64 !== 'string') {
      throw new LabChannelError(channel, 'the docs entry needs dataBase64');
    }
    view.path = result.path;
    view.name = result.name ?? null;
    view.hash = result.hash ?? null;
    return {
      path: result.path,
      name: result.name,
      data: decodeBase64Buffer(result.dataBase64),
      hash: result.hash,
    };
  };

  const byApp = {
    docs: {
      desktop: {
        ...common,
        consumePendingOpenDocx: async () => docsEntry(await call('host:docs-consume-pending-open', {}), 'host:docs-consume-pending-open'),
        openDocx: async () => docsEntry(await call('host:docs-consume-pending-open', {}), 'host:docs-consume-pending-open'),
        openDocxPath: async (path) => docsEntry(await call('host:docs-open-path', { path }), 'host:docs-open-path'),
        consumeNewBlankDoc: async () => (await call('host:docs-consume-new-blank', {})).blank === true,
        // Mount-time call (App.tsx:2307): null when this is not a headless-export
        // session, so an empty queue is a supported empty result, never a throw.
        consumeAiDocContent: async () => null,
        consumeHeadlessExport: async () => null,
        // Mount/effect reads of the pinned docs renderer that carry no .catch. Explicit
        // lab semantics (see the docs mount truth block above); none of them reports a
        // document, a save, an AI result or a login state.
        getRecentFiles: async () => [],
        getAiSettings: async () => labDocsAiSettings(),
        // Void upstream (preload/index.ts:197-201). The optional call at App.tsx:1575
        // does not protect against a synchronous throw, so this is a real recorded
        // report forwarded to the channel the lab already owns.
        reportViewMenuState: (state) => {
          reports.viewMenuState = {
            aiSidebar: state?.aiSidebar === true,
            darkCanvas: state?.darkCanvas === true,
          };
          send('host:view-menu-state', reports.viewMenuState);
        },
        // DOC-003 r2 password: decrypt-and-open for the renderer prompt (App.tsx submitDocPwd). The
        // server answers the desktop DecryptOpenResult; a refusal is passed through, never retried.
        openDocxDecrypt: async (path, password) => {
          const res = await call('host:docs-open-decrypt', { path: String(path ?? ''), password: String(password ?? '') });
          if (res && res.ok === true) return { ok: true, result: docsEntry(res.result, 'host:docs-open-decrypt') };
          if (res && res.ok === false) {
            const reason = res.reason === 'wrong-password' || res.reason === 'unsupported' ? res.reason : 'error';
            return { ok: false, reason, error: String(res.error ?? '') };
          }
          throw new LabChannelError('host:docs-open-decrypt', 'expected a DecryptOpenResult');
        },
        docPasswordIntentRevision: async () => 0,
        discardDocPasswordIntents: async () => ({ ok: true }),
        saveDocx: async (path, data, auto) =>
          call('host:docs-save', { path, dataBase64: asBase64(data, 'host:docs-save'), auto: auto === true }),
        saveDocxNew: async (defaultName, data) =>
          call('host:docs-save-new', { defaultName, dataBase64: asBase64(data, 'host:docs-save-new') }),
        saveDocxAs: async (defaultName, data, sourcePath) =>
          call('host:docs-save-as', {
            defaultName,
            dataBase64: asBase64(data, 'host:docs-save-as'),
            sourcePath: sourcePath ?? null,
          }),
        saveDocxTo: async (path, data, overwrite) =>
          call('host:docs-save-to', {
            path,
            dataBase64: asBase64(data, 'host:docs-save-to'),
            overwrite: overwrite === true,
          }),
        writeRecoveryCopy: async (path, data) =>
          call('host:docs-write-recovery', { path, dataBase64: asBase64(data, 'host:docs-write-recovery') }),
        reportCloseCheck: async (payload) => {
          reports.closeCheck = payload ?? null;
          return { ok: true };
        },
        convertAltChunkHtml: async (html) => {
          const result = await call('host:docs-convert-altchunk', { html: String(html ?? '') });
          if (result === null) return null;
          if (!result || typeof result.base64 !== 'string') {
            throw new LabChannelError('host:docs-convert-altchunk', 'expected { base64 } or null');
          }
          return new Uint8Array(decodeBase64Buffer(result.base64));
        },
        ...recorded,
      },
    },
    markdown: {
      markdownApi: {
        ...common,
        closeDocument: () => call('lab:session-close', {}),
        readLink: (href) => call('host:markdown-read-link', { href }),
        consumePending: textConsumePending,
        readFile: textRead,
        save: (request) => textSave(request, '.md'),
        consumeHeadlessExport: async () => null,
        readImage,
        saveImage,
        saveImageAs,
        pickImage,
        // The server-issued view id a renderer needs to build its same-origin
        // /lab/asset/<viewId>/<relative> URL. Read at call time, so it is never a
        // stale value captured before lab:session-open.
        assetViewId: () => (typeof sessionId === 'function' ? sessionId() : null),
        ...recorded,
      },
    },
    html: {
      htmlApi: {
        ...common,
        consumePending: textConsumePending,
        readFile: textRead,
        save: (request) => textSave(request, '.html'),
        consumeHeadlessExport: async () => null,
        readImage,
        saveImage,
        saveImageAs,
        pickImage,
        // Awaited flush: the renderer pushes, awaits the version ack, and only then
        // points the frame at the URL, so a rapid follow-up edit cannot be served stale.
        updatePreview: (text) => call('host:html-update-preview', { text: String(text ?? '') }),
        getPreviewInfo: async () => call('host:html-preview-info', {}),
        presentInNewTab: async (title) => flagOf(await call('host:html-present-new-tab', { title }), 'opened', 'host:html-present-new-tab'),
        setPresentFullScreen: async (on) => call('host:html-present-fullscreen', { on: on === true }),
        ...recorded,
      },
    },
    pdf: {
      pdfApi: {
        ...common,
        consumePending: pdfConsumePending,
        readFile: async (path) => {
          const result = await call('host:pdf-read-file', { path: String(path ?? '') });
          if (!result || typeof result.base64 !== 'string') {
            throw new LabChannelError('host:pdf-read-file', 'the PDF bytes must come back as result.base64');
          }
          return decodeBase64Buffer(result.base64);
        },
        save: (request) => {
          if (!request || typeof request !== 'object' || typeof request.path !== 'string') {
            throw new HostCapabilityError('pdfApi.save', 'the real SavePdfRequest with a source path is required');
          }
          return call('host:pdf-save', request);
        },
        // lab-server.mjs:691-693 reads body.nameCandidate; sending baseName silently fell back
        // to the current basename, so no rename ever happened.
        autoRename: async (path, baseName) =>
          call('host:pdf-auto-rename', { path, nameCandidate: baseName }),
        // The lab handler answers a bare boolean (lab-server.mjs:701-704) and the upstream
        // preload contract is boolean; reading .untitled turned a true into false.
        isUntitled: async (path) =>
          flagOf(await call('host:pdf-is-untitled', { path }), 'untitled', 'host:pdf-is-untitled'),
        getUsername: async () => (await call('host:username', {})).name ?? '',
        // Inspection APIs the renderer uses before an edit. Shapes follow
        // apps/pdf/src/shared/ipc.ts (validateTextEdits -> TextEditValidation[],
        // listEditFonts -> string[], canDrawText -> boolean, listPageImages -> PageImageRef[],
        // listStaticFormFills -> StaticFormFillRecord[]).
        validateTextEdits: async (request) => call('host:pdf-validate-text-edits', { ...(request ?? {}) }),
        listEditFonts: async () => call('host:pdf-list-edit-fonts', {}),
        canDrawText: async (text, font, bold, italic) =>
          flagOf(
            await call('host:pdf-can-draw-text', { text: String(text ?? ''), font: font ?? null, bold: bold === true, italic: italic === true }),
            'drawable',
            'host:pdf-can-draw-text',
          ),
        // The upstream preload signature is listPageImages(path) (preload/index.ts:20) and the
        // renderer passes a raw string (App.tsx:1638, :5264). Spreading a string produced
        // {0:'C',1:':',...} so body.path was undefined. Accept both forms; the object form is
        // what the existing adapter test uses.
        listPageImages: async (pathOrRequest) =>
          call('host:pdf-list-page-images',
            typeof pathOrRequest === 'string' ? { path: pathOrRequest } : { ...(pathOrRequest ?? {}) }),
        // Upstream preload takes the document path (preload/index.ts:21) and App.tsx:1006
        // passes one; the lab handler reads body.path (lab-server.mjs:745-748).
        listStaticFormFills: async (path) =>
          call('host:pdf-list-static-form-fills', { path: path ?? null }),
        // Lab-only candidate (Advisor decision g117 option (a)): the two missing render
        // capabilities of the PDF image-edit flow. The channels do the real work; this adapter
        // shapes the requests and rejects (never throws synchronously) so the renderer catch path runs.
        pageImagePng: async (request) => {
          if (!request || typeof request !== 'object' || typeof request.path !== 'string' || request.path.length === 0) {
            throw new HostCapabilityError('pdfApi.pageImagePng', 'pageImagePng needs { path, pageIndex, rect, scale }');
          }
          const result = await call('host:pdf-page-image-png', {
            path: String(request.path),
            pageIndex: Number(request.pageIndex),
            rect: Array.isArray(request.rect) ? request.rect.map(Number) : null,
            scale: request.scale === undefined ? null : Number(request.scale),
          });
          if (!result || typeof result.base64 !== 'string' || result.base64.length === 0) {
            throw new LabChannelError('host:pdf-page-image-png', 'the rendered page image must come back as result.base64');
          }
          return result.base64;
        },
        pagePreviewPng: async (request) => {
          if (!request || typeof request !== 'object' || typeof request.path !== 'string' || request.path.length === 0) {
            throw new HostCapabilityError('pdfApi.pagePreviewPng', 'pagePreviewPng needs { path, pageIndex, clip, pxWidth, rotate }');
          }
          const result = await call('host:pdf-page-preview-png', {
            path: String(request.path),
            pageIndex: Number(request.pageIndex),
            excludeRects: Array.isArray(request.excludeRects) ? request.excludeRects : [],
            clip: request.clip === undefined ? null : request.clip,
            pxWidth: Number(request.pxWidth),
            rotate: Number(request.rotate),
          });
          if (result === null || result === undefined) return null;
          if (typeof result.base64 !== 'string' || result.base64.length === 0) {
            throw new LabChannelError('host:pdf-page-preview-png', 'the preview raster must come back as result.base64');
          }
          return result.base64;
        },
        consumeHeadlessExport: async () => null,
        ...recorded,
      },
    },
    sheets: {
      desktopApi: {
        ...common,
        // Both are bare booleans in the preload (desktop-api.ts:2639, :2648).
        consumeNewBlankWorkbook: async () => flagOf(await call('host:sheets-consume-new-blank', {}), 'blank', 'host:sheets-consume-new-blank'),
        hasQueuedWorkbook: async () => flagOf(await call('host:sheets-has-queued', {}), 'queued', 'host:sheets-has-queued'),
        selectWorkbook: async (path) => {
          const result = await call('host:sheets-select-workbook', { path: path ?? null });
          if (result === null) return null;
          if (result && result.workbook) return result.workbook;
          if (result && typeof result.sessionId === 'string') return result;
          throw new LabChannelError('host:sheets-select-workbook', 'expected a WorkbookFile or null');
        },
        readWorkbookRange: async (request) => call('host:sheets-read-range', { ...(request ?? {}) }),
        readWorkbookFormulas: async (request) => call('host:sheets-read-formulas', { ...(request ?? {}) }),
        recalcWorkbook: async (request) => call('host:sheets-recalc', { ...(request ?? {}) }),
        saveWorkbookEdits: async (request) => call('host:sheets-save-edits', { ...(request ?? {}) }),
        writeWorkbookRecovery: async (request) => call('host:sheets-write-recovery', { ...(request ?? {}) }),
        closeWorkbook: async (sessionId) => call('host:sheets-close', { sessionId }),
        autoRenameWorkbook: async (sessionId, baseName) => call('host:sheets-auto-rename', { sessionId, baseName }),
        replyRecoveryPrompt: async (answer) => call('host:sheets-reply-recovery', { answer }),
        // Large edits travel in slices; the transfer methods keep their upstream
        // arity and their void-in-Promise shape.
        beginSaveEditsTransfer: async (request) => call('host:sheets-edits-begin', { ...(request ?? {}) }),
        sendSaveEditsChunk: async (request) => call('host:sheets-edits-chunk', { ...(request ?? {}) }),
        abortSaveEditsTransfer: async (request) => call('host:sheets-edits-abort', { ...(request ?? {}) }),
        getPathForFile: () => '',
        consumeHeadlessExport: async () => null,
        // Mount read the pinned sheets App performs WITHOUT ?. and without .catch
        // (App.tsx:1469-1471). A synchronous unsupported throw would escape that effect
        // before any handler could run. The lab keeps no AI settings store and holds no
        // credentials, so the truthful answer is the same pinned unconfigured shape the
        // docs desktop and slides slidesApi blocks already return through this helper
        // (prechange file: docs at :640, slides at :873). Nothing here enables AI: every
        // apiKey is empty and gskToolsEnabled/media/search stay absent, so no cloud-tools
        // opt-in is asserted; aiStream, aiGskLogin and webSearch keep failing loudly.
        getAiSettings: async () => labDocsAiSettings(),
        ...recorded,
      },
    },
    slides: {
      slidesApi: {
        ...common,
        consumePendingOpen: async (fitWidthPx) =>
          openResultOf(await call('host:slides-consume-pending', { fitWidthPx: fitWidthPx ?? null }), 'host:slides-consume-pending'),
        openPptx: async (fitWidthPx) =>
          openResultOf(await call('host:slides-open', { fitWidthPx: fitWidthPx ?? null }), 'host:slides-open'),
        openPptxPath: async (path, fitWidthPx) =>
          openResultOf(await call('host:slides-open-path', { path, fitWidthPx: fitWidthPx ?? null }), 'host:slides-open-path'),
        newBlank: async (fitWidthPx) => {
          const result = await call('host:slides-new-blank', { fitWidthPx: fitWidthPx ?? null });
          if (!result || typeof result !== 'object' || !Array.isArray(result.slides)) {
            throw new LabChannelError('host:slides-new-blank', 'expected an OpenResult');
          }
          return result;
        },
        // ipc.ts:1639 Promise<GetLayoutsResult | null>; ipc.ts:681 GetLayoutsResult = { layouts, size }.
        // pptx-layouts is a real read-only engine route now, so a real catalog is passed through
        // in the ipc shape. A null answer stays null (no open deck); anything that is not a
        // well-formed catalog is a contract error, never a silent empty catalog.
        getLayouts: async () => {
          const result = await call('host:slides-layouts', {});
          if (result === null) return null;
          if (
            result &&
            typeof result === 'object' &&
            Array.isArray(result.layouts) &&
            result.size &&
            typeof result.size === 'object' &&
            typeof result.size.cx === 'number' &&
            typeof result.size.cy === 'number'
          ) {
            return { layouts: result.layouts, size: { cx: result.size.cx, cy: result.size.cy } };
          }
          throw new LabChannelError('host:slides-layouts', 'expected a { layouts, size } catalog or null');
        },
        isDirty: async () => flagOf(await call('host:slides-is-dirty', {}), 'dirty', 'host:slides-is-dirty'),
        save: async () => {
          const result = await call('host:slides-save', {});
          if (!result || typeof result !== 'object') {
            throw new LabChannelError('host:slides-save', 'expected a SaveSlidesResult');
          }
          return result;
        },
        saveAs: async (defaultName) => call('host:slides-save-as', { defaultName }),
        // Real per-element edit operations: the generic txn ack is not a substitute
        // for these renderer APIs, so each one keeps its upstream request/result shape.
        editText: async (op) => call('host:slides-edit-text', { ...(op ?? {}) }),
        setElementFont: async (op) => call('host:slides-set-element-font', { ...(op ?? {}) }),
        setElementParagraphFormat: async (op) => call('host:slides-set-paragraph-format', { ...(op ?? {}) }),
        editTransform: async (op) => call('host:slides-edit-transform', { ...(op ?? {}) }),
        batchEditTransform: async (op) => call('host:slides-batch-transform', { ...(op ?? {}) }),
        editTableCell: async (op) => call('host:slides-edit-table-cell', { ...(op ?? {}) }),
        addElement: async (op) => call('host:slides-add-element', { ...(op ?? {}) }),
        addImageBytes: async (op) => call('host:slides-add-image-bytes', { ...(op ?? {}) }),
        replacePictureBytes: async (op) => call('host:slides-replace-picture-bytes', { ...(op ?? {}) }),
        // ipc.ts:1354 `pickPictureFile: () => Promise<{ base64, ext } | null>`; the
        // native handler is slides-main.ts:2288-2305. The lab has no OS chooser, so
        // the channel reads the operator-named image for real and this binding only
        // validates the preload's exact union: a cancel is the documented `null`,
        // a real pick is { base64: string, ext: string }, and anything else is a
        // contract error rather than a half-formed pick.
        pickPictureFile: async () => {
          const result = await call('host:slides-pick-picture-file', {});
          if (result === null || result === undefined) return null;
          if (
            result &&
            typeof result === 'object' &&
            typeof result.base64 === 'string' &&
            typeof result.ext === 'string'
          ) {
            return { base64: result.base64, ext: result.ext };
          }
          throw new LabChannelError('host:slides-pick-picture-file', 'expected { base64, ext } or null');
        },
        getRenderSlides: async () => call('host:slides-render-slides', {}),
        getRecentFiles: async () => {
          const result = await call('host:slides-recent', {});
          return Array.isArray(result) ? result : [];
        },
        // Mount reads the pinned slides App performs without .catch (App.tsx:1198, 461, 330, 1607,
        // 1636, 1854, 1878, 2000, 2659, 3409, 3480). Truthful lab values: no AI settings store, no
        // system clipboard, no font store, no per-slide annotation stores, no section list. None of
        // this fakes an AI login, an edit, a save or unread deck metadata.
        getAiSettings: async () => labDocsAiSettings(),
        clipboardProbe: async () => false,
        fontMissing: async () => [],
        getTransition: async () => 'none',
        getAnimations: async () => [],
        getNotes: async () => '',
        getComments: async () => [],
        getSections: async () => [],
        getChartColorSchemes: async () => [],
        hasSlideClipboard: async () => false,
        consumeHeadlessExport: async () => null,
// aiGskStatus is deliberately not implemented here: it rejects once A4 lists slidesApi in
// UNSUPPORTED_REJECTING_METHODS. That rejection (HostCapabilityError) is the exact behavior
// AiPanel.tsx:531-535/:1485 handle in their .catch(() => {}).
        ...recorded,
      },
      desktop: {
        getPathForFile: () => '',
      },
    },
  };

  return byApp[app] ?? {};
}

/* ----------------------------------------------------------------- adapter ---- */

/**
 * Builds the explicit host for one app.
 *
 * transport, prefs and declared are injected:
 *   * transport - the lab JSON transport, already bound to the server view id
 *   * prefs     - real preference/event state
 *   * declared  - the frozen window.<api> method surface from the pinned source
 *                 (host-surface.mjs). Declared methods with no implementation above
 *                 become HostCapabilityError throws, so an unsupported call is loud.
 */
export function createHostAdapter({ app, transport, prefs, session, declared } = {}) {
  if (!app) throw new Error('lab host: an app name is required');
  if (!HOST_SURFACE[app]) throw new Error('lab host: unknown app ' + app);
  if (!transport || typeof transport.call !== 'function') {
    throw new Error('lab host: app ' + app + ' needs a transport');
  }
  const globals = globalsForApp(app);
  const state = prefs ?? createHostPreferences();
  const surface = declared ?? HOST_SURFACE[app];
  const view = session ?? { path: null, name: null, hash: null };
  const reports = {
    dirty: null,
    closeCheck: null,
    viewMenuState: null,
    closeSaveResults: [],
    saveAcks: [],
    headlessExport: [],
    pendingEdits: 0,
    provisionalTitle: null,
    sends: [],
    sendFailures: [],
  };

  const call = (channel, payload) => transport.call(channel, payload ?? {});
  // A one-way send must never reject into the renderer (they are void upstream) and
  // must never be counted as delivered when it failed: the failure is recorded on
  // the adapter and the renderer's local dirty state is left untouched.
  const send = (channel, payload) => {
    Promise.resolve(call(channel, payload)).then(
      () => reports.sends.push({ channel, payload }),
      (error) => reports.sendFailures.push({ channel, error: String((error && error.message) || error) }),
    );
  };
  const implementations = buildImplementations({
    app,
    call,
    send,
    state,
    view,
    reports,
    sessionId: () => transport.viewId,
  });

  const adapter = {};
  const capability = {};
  for (const globalName of globals) {
    const target = { ...(implementations[globalName] ?? {}) };
    const declaredHere = (surface[globalName] ?? []).slice();
    const required = new Set([...Object.keys(target), ...declaredHere, ...(AUX_METHODS[globalName] ?? [])]);
    for (const method of required) {
      if (method in target) continue;
      // Required event subscriptions are real: every on* builds a working handler
      // registry and a real unsubscribe. It is deliberately not a silent no-op, so
      // it cannot be mistaken for evidence that the feature works.
      target[method] = /^on[A-Z]/.test(method)
        ? (handler) => state.on(eventNameFor(method), handler)
        : (UNSUPPORTED_REJECTING_METHODS[globalName] ?? []).includes(method)
          ? unsupportedRejecting(globalName, method, 'not implemented by the DOC-003 lab host')
          : unsupported(globalName, method, 'not implemented by the DOC-003 lab host');
    }
    adapter[globalName] = target;
    capability[globalName] = {
      declared: declaredHere,
      implemented: Object.keys(target).filter(
        (m) => !target[m].throwsOnCall && !target[m].rejectsOnCall && !/^on[A-Z]/.test(m),
      ),
      subscriptions: Object.keys(target).filter((m) => /^on[A-Z]/.test(m)),
      unsupported: Object.keys(target).filter((m) => target[m].throwsOnCall || target[m].rejectsOnCall),
      unsupportedRejecting: Object.keys(target).filter((m) => target[m].rejectsOnCall),
    };
  }

  return {
    app,
    view,
    prefs: state,
    globals: adapter,
    reports,
    /** Real session open; the page bootstrap calls it before importing the app entry. */
    openSession: async ({ path: fixture = null } = {}) => {
      const result = await transport.openSession({ app, path: fixture });
      view.path = result.path ?? fixture;
      view.name = result.name ?? null;
      view.hash = result.hash ?? null;
      return result;
    },
    /**
     * Delivers one event to this view. Server-pushed events arrive with the method
     * name the renderer subscribed with (onDeckChanged, onHistoryChanged, ...); a
     * renderer-local event may be emitted directly and is documented as local.
     */
    deliver: (event, value) => state.emit(eventNameFor(event), value),
    /** Explicit capability report; the tests and the shipped report both read this. */
    capabilities: () => ({
      app,
      viewId: transport.viewId,
      globals: capability,
      reports: { ...reports, closeSaveResults: [...reports.closeSaveResults], saveAcks: [...reports.saveAcks], headlessExport: [...reports.headlessExport], sendFailures: [...reports.sendFailures] },
    }),
  };
}
