// Vendored from the genoffice fork (UNIAI-TEAM/uniwork-office),
// web/docs/protocol/types.ts at 4cd31f81d26f0462e8a3f6b4b2cbd856b4145c16
// (lane branch feature/UNI-1013-docs-web-bridge). Byte-identical except the
// relative import specifiers (./types -> ./docs-frame-protocol, ./endpoint ->
// ./docs-frame-endpoint). Do not edit here: change the fork, re-vendor, update this SHA.
/* eslint-disable max-lines -- vendored contract file, kept identical to the fork */
/**
 * UniWork <-> genoffice Docs frame protocol (UNI-1013, lane GO-B2+B3).
 *
 * DEPENDENCY-FREE ON PURPOSE: no imports. The UniWork host vendors this file
 * verbatim (dev-uniwork packages/core/office/docs-frame-protocol.ts, with the
 * fork SHA in a header comment). Keep it that way.
 *
 * Wire model: every message is one `Envelope`
 *   { ns, v, id, kind: 'request' | 'response' | 'event', type, payload, error? }
 * - `ns` tags our traffic so foreign postMessage noise (devtools, extensions)
 *   is ignored instead of reported.
 * - `v` is PROTOCOL_VERSION of the sender, on every message. A receiver with a
 *   different version answers requests with a `version_mismatch` error and
 *   drops responses/events.
 * - `id` is unique per sender; a response echoes the request's `id` and `type`.
 * - A response carries either `payload` (success) or `error` (failure).
 *
 * Direction is part of the contract: `HostRequests` / `HostEvents` are sent
 * by the UniWork page to the frame, `FrameRequests` / `FrameEvents` by the
 * frame to the page. See README.md for the message table and the auth/origin
 * model. Changes after the contract commit must be additive or announced.
 */

export const PROTOCOL_NS = 'uniwork.office.docs' as const
/** Bump on any breaking change. Peers must match exactly. */
export const PROTOCOL_VERSION = 1 as const

// ---------------------------------------------------------------- envelope

export type MessageKind = 'request' | 'response' | 'event'

export interface Envelope<T extends string = string, P = unknown> {
  ns: typeof PROTOCOL_NS
  v: number
  id: string
  kind: MessageKind
  type: T
  payload?: P
  error?: ProtocolErrorShape
}

export interface RequestEnvelope<T extends string = string, P = unknown> extends Envelope<T, P> {
  kind: 'request'
  payload: P
}

export interface ResponseEnvelope<T extends string = string, R = unknown> extends Envelope<T, R> {
  kind: 'response'
}

export interface EventEnvelope<T extends string = string, P = unknown> extends Envelope<T, P> {
  kind: 'event'
  payload: P
}

// ---------------------------------------------------------------- errors

export type ProtocolErrorCode =
  /** the request got no response within its timeout */
  | 'timeout'
  /** the caller aborted the request (AbortSignal) or the endpoint was disposed */
  | 'cancelled'
  /** peers speak different PROTOCOL_VERSIONs */
  | 'version_mismatch'
  /** structurally invalid message or payload */
  | 'malformed'
  /** no handler registered for this request type */
  | 'unknown_type'
  /** frame got an API request before `init` / host before `ready` */
  | 'not_ready'
  /** token missing/expired/rejected (HTTP 401) */
  | 'unauthorized'
  /** HTTP 403 */
  | 'forbidden'
  /** HTTP 404 */
  | 'not_found'
  /** the document changed on the server (HTTP 409 / 412 If-Match failed) */
  | 'conflict'
  /** HTTP 413 */
  | 'too_large'
  /** HTTP 429 */
  | 'rate_limited'
  /** fetch failed / offline */
  | 'network'
  /** capability not available in this deployment (e.g. AI on the web) */
  | 'unsupported'
  /** the same operation is already running (e.g. a second save while one is in flight); retry later */
  | 'busy'
  /** anything else (HTTP 5xx, thrown exceptions) */
  | 'internal'

export const PROTOCOL_ERROR_CODES: readonly ProtocolErrorCode[] = [
  'timeout',
  'cancelled',
  'version_mismatch',
  'malformed',
  'unknown_type',
  'not_ready',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'too_large',
  'rate_limited',
  'network',
  'unsupported',
  'busy',
  'internal',
]

/** The serialisable error carried in `Envelope.error` and the `error` event. */
export interface ProtocolErrorShape {
  code: ProtocolErrorCode
  /** developer-facing English text; UIs map `code` to i18n strings */
  message: string
  /** true when retrying the same request may succeed */
  retryable?: boolean
  /** originating HTTP status, when the error came from a UniWork API call */
  status?: number
  /** small, JSON-safe extra data (e.g. { remoteVersion: 2 }) */
  details?: Record<string, unknown>
}

/** Thrown/rejected by host.ts and client.ts. `instanceof`-checkable. */
export class DocsProtocolError extends Error implements ProtocolErrorShape {
  readonly code: ProtocolErrorCode
  readonly retryable?: boolean
  readonly status?: number
  readonly details?: Record<string, unknown>

  constructor(shape: ProtocolErrorShape) {
    super(shape.message)
    this.name = 'DocsProtocolError'
    this.code = shape.code
    if (shape.retryable !== undefined) this.retryable = shape.retryable
    if (shape.status !== undefined) this.status = shape.status
    if (shape.details !== undefined) this.details = shape.details
  }

  toShape(): ProtocolErrorShape {
    const out: ProtocolErrorShape = { code: this.code, message: this.message }
    if (this.retryable !== undefined) out.retryable = this.retryable
    if (this.status !== undefined) out.status = this.status
    if (this.details !== undefined) out.details = this.details
    return out
  }
}

/** Map an HTTP status from a UniWork API call to a protocol error. */
export function errorFromHttpStatus(status: number, message?: string): DocsProtocolError {
  const code: ProtocolErrorCode =
    status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status === 409 || status === 412
            ? 'conflict'
            : status === 413
              ? 'too_large'
              : status === 429
                ? 'rate_limited'
                : 'internal'
  return new DocsProtocolError({
    code,
    message: message ?? `HTTP ${status}`,
    status,
    retryable: status === 429 || status >= 500,
  })
}

/** Normalise anything thrown by a handler into a protocol error. */
export function toProtocolError(err: unknown): DocsProtocolError {
  if (err instanceof DocsProtocolError) return err
  if (isProtocolErrorShape(err)) return new DocsProtocolError(err)
  if (err instanceof Error) {
    if (err.name === 'AbortError')
      return new DocsProtocolError({ code: 'cancelled', message: err.message })
    if (err.name === 'TypeError' && /fetch|network/i.test(err.message)) {
      return new DocsProtocolError({ code: 'network', message: err.message, retryable: true })
    }
    return new DocsProtocolError({ code: 'internal', message: err.message })
  }
  return new DocsProtocolError({ code: 'internal', message: String(err) })
}

// ---------------------------------------------------------------- shared payload types

export type Theme = 'light' | 'dark'

/** Feature switches the host grants the frame. Unknown keys must be ignored. */
export type Capability =
  | 'save'
  | 'saveAs'
  | 'recents'
  /** `file.pick` (File > Open / Ctrl+O): the host has a document picker */
  | 'filePick'
  | 'print'
  | 'exportPdf'
  | 'exportHtml'
  | 'attachments'
  | 'images'
  /** stays false on the web in this lane (AI/search/image stubbed + hidden) */
  | 'ai'

export type Capabilities = Partial<Record<Capability, boolean>>

export const CAPABILITY_KEYS: readonly Capability[] = [
  'save',
  'saveAs',
  'recents',
  'filePick',
  'print',
  'exportPdf',
  'exportHtml',
  'attachments',
  'images',
  'ai',
]

/**
 * How the frame reaches UniWork APIs.
 * - 'host-proxy' (v1 default): the frame sends `api.*` requests over
 *   postMessage; the host page performs the token-authorised fetches.
 * - 'direct': the frame calls `apiBase` itself with
 *   `Authorization: Bearer <token>` and `credentials: 'omit'` (for when the
 *   frame moves to its own subdomain). Never cookies.
 */
export type ApiMode = 'host-proxy' | 'direct'

export interface TokenPayload {
  /** short-lived, server-minted, scoped to one document + workspace */
  token: string
  /** absolute expiry, epoch milliseconds */
  tokenExpiresAt: number
}

export interface FileMeta {
  /** UniWork file id (opaque) */
  fileId: string
  /** display name incl. extension, e.g. "Report.docx" */
  name: string
  sizeBytes?: number
  mimeType?: string
  /** server version id of the bytes being opened/saved */
  versionId?: string
  /** opaque concurrency token; sent back as If-Match on save */
  etag?: string
  /** last modification, epoch milliseconds */
  modifiedAt?: number
  /** false when the user may only view */
  writable?: boolean
}

/** Where the document bytes come from. */
export type FileSource =
  /** signed, short-lived download URL; fetched with credentials: 'omit' */
  | { kind: 'url'; url: string; headers?: Record<string, string> }
  /** raw bytes (transferred, not copied, when possible) */
  | { kind: 'bytes'; data: ArrayBuffer }

// ---------------------------------------------------------------- handshake

export interface ReadyPayload {
  /** the frame's PROTOCOL_VERSION */
  protocolVersion: number
  /** build id of the frame bundle (W1 manifest version / SHA) */
  frameVersion?: string
  /** what the frame can do, before the host grants anything */
  capabilities: Capabilities
  /**
   * random per frame-document id (additive). Every `ready` of one page load carries the
   * same value; a different value while a handshake is in flight means the frame reloaded
   * and the host restarts the handshake.
   */
  instanceId?: string
}

export interface InitPayload extends TokenPayload {
  protocolVersion: number
  documentId: string
  workspaceId: string
  /** absolute API origin + prefix, e.g. "https://app.uniwork.vn/api" */
  apiBase: string
  apiMode: ApiMode
  /** BCP-47, e.g. "vi", "en" */
  locale: string
  theme: Theme
  capabilities: Capabilities
  /** optional: open this immediately (saves a round-trip vs. a later `open`) */
  open?: OpenPayload
}

export interface InitAck {
  protocolVersion: number
  frameVersion?: string
  /** effective capabilities (frame ∩ host-granted) */
  capabilities: Capabilities
}

// ---------------------------------------------------------------- document payloads

export interface OpenPayload {
  file: FileMeta
  source: FileSource
}

export interface OpenResult {
  /** the editor finished loading the document */
  opened: true
  /** document title as the editor shows it */
  title?: string
}

export interface SaveRequestPayload {
  /** why the host asks: toolbar/shortcut, before navigating away, timer */
  reason: 'user' | 'navigate' | 'autosave'
}

export type SaveResult =
  | {
      ok: true
      file: FileMeta
      /** server version created by this save */
      versionId?: string
    }
  | {
      ok: false
      /** nothing to save (not dirty) is ok:true with the current file instead */
      error: ProtocolErrorShape
    }

export interface SaveAsRequestPayload {
  /** suggested name; the host/user may change it */
  name?: string
}

export interface PrintPayload {
  /** 'dialog' = window.print() inside the frame; 'pdf' = server export */
  mode?: 'dialog' | 'pdf'
}

// ---------------------------------------------------------------- API payloads (frame -> host, host-proxy mode)

export interface ApiOpenPayload {
  fileId: string
}

export interface ApiSavePayload {
  fileId: string
  data: ArrayBuffer
  /** last known etag; the host sends it as If-Match. Mismatch -> 'conflict' */
  etag?: string
  /** autosave/recovery write (no user-visible version bump if the server supports it) */
  auto?: boolean
}

export interface ApiSaveAsPayload {
  name: string
  data: ArrayBuffer
  /** file this was derived from (folder/workspace defaulting) */
  sourceFileId?: string
  folderId?: string
  /** true = first save of a new doc, server picks folder + unique name, no dialog */
  silent?: boolean
}

export interface ApiRecentsPayload {
  limit?: number
}

export interface ApiRecentsResult {
  files: FileMeta[]
}

export interface ApiExportPayload {
  format: 'pdf' | 'html'
  /** the stored file to export (its last saved version) ... */
  fileId?: string
  /**
   * ... or the current in-editor docx bytes (transferred). The frame sends them
   * when the document has unsaved edits (or was never saved). When present they
   * take precedence over `fileId` (which then only identifies the document for
   * naming / authorisation). Hosts without byte support ignore `data` and export
   * `fileId`'s stored version.
   */
  data?: ArrayBuffer
  html?: string
  /** page geometry for server PDF rendering */
  pageWidthTwips?: number
  pageHeightTwips?: number
  scale?: number
  /** suggested download name */
  name?: string
}

export interface ApiExportResult {
  data: ArrayBuffer
  mimeType: string
  name?: string
}

export interface UploadItem {
  name: string
  mimeType: string
  data: ArrayBuffer
}

export interface AttachmentMetaWeb {
  attachmentId: string
  name: string
  /** lowercased extension without the dot */
  ext: string
  sizeBytes: number
}

export interface ApiAttachmentsAddPayload {
  files: UploadItem[]
}

export interface ApiAttachmentsAddResult {
  accepted: AttachmentMetaWeb[]
  /** per-file rejection messages (too large / unsupported type) */
  rejected: string[]
}

export interface ApiImageUploadPayload extends UploadItem {
  fileId?: string
}

export interface ApiImageUploadResult {
  imageId: string
  /** URL usable in the editor (same-origin or signed) */
  url: string
}

// ---------------------------------------------------------------- event payloads

export interface DirtyPayload {
  dirty: boolean
}

export interface TitlePayload {
  title: string
}

/**
 * The frame opened / closed one of its own modal dialogs (save conflict, discard prompt, fatal
 * notice). Its scrim only covers the iframe; a host may dim its own chrome around it while
 * `open` is true. Advisory: hosts that ignore it lose nothing.
 */
export interface ModalPayload {
  open: boolean
}

export interface ThemePayload {
  theme: Theme
}

export interface LanguagePayload {
  locale: string
}

export interface ResizePayload {
  /** content height in CSS px (for hosts that size the iframe to content) */
  height: number
}

export interface SavedPayload {
  file: FileMeta
  versionId?: string
  /** true when triggered by the frame (Ctrl+S / autosave), false for host `save` */
  initiatedByFrame: boolean
}

export interface ErrorEventPayload {
  error: ProtocolErrorShape
  /** the editor cannot continue; the host should show a fallback */
  fatal: boolean
}

export interface CancelPayload {
  /** id of the request to cancel (sent by the requester) */
  id: string
}

// ---------------------------------------------------------------- additive (W3 needs, after b7c541f)

export interface FilePickPayload {
  /** what the picked file is for; the host may show a different picker per purpose */
  purpose: 'open' | 'insert'
  /** lowercased extensions without the dot, e.g. ["docx"] */
  accept?: string[]
}

export interface FilePickResult {
  /** null when the user cancelled */
  file: OpenPayload | null
}

export interface ImageFetchPayload {
  /** remote http(s) image URL; the host fetches it server-side (SSRF-guarded) */
  url: string
}

export interface ImageFetchResult {
  /** null when the image could not be fetched */
  image: { base64: string; mime: string } | null
}

export interface ConvertAltChunkHtmlPayload {
  html: string
}

export interface ConvertAltChunkHtmlResult {
  /** converted docx bytes, null when conversion is unavailable/failed */
  data: ArrayBuffer | null
}

export interface CloseCheckResult {
  dirty: boolean
  /** true when the frame will autosave by itself (no prompt needed) */
  autoSave: boolean
}

export interface FileRenamedPayload {
  /** the document's new metadata (name changed elsewhere) */
  file: FileMeta
}

export interface TokenRefreshRequestPayload {
  reason: 'expiring' | 'unauthorized'
}

// ---------------------------------------------------------------- direction maps

interface Rpc<P, R> {
  payload: P
  result: R
}

/** Requests the host sends to the frame. */
export interface HostRequests {
  init: Rpc<InitPayload, InitAck>
  open: Rpc<OpenPayload, OpenResult>
  save: Rpc<SaveRequestPayload, SaveResult>
  saveAs: Rpc<SaveAsRequestPayload, SaveResult>
  print: Rpc<PrintPayload, { printed: boolean }>
  /** before closing/navigating: is there unsaved work? (then `save` with reason 'navigate') */
  'doc.closeCheck': Rpc<Record<string, never>, CloseCheckResult>
}

/** Events the host sends to the frame. */
export interface HostEvents {
  /** proactive token rotation (host-initiated refresh) */
  'token.update': TokenPayload
  theme: ThemePayload
  language: LanguagePayload
  /** host aborts one of its own host->frame requests */
  cancel: CancelPayload
  /** the open document was renamed outside the editor */
  'file.renamed': FileRenamedPayload
}

/** Requests the frame sends to the host. `api.*` are proxied to UniWork APIs. */
export interface FrameRequests {
  'token.refresh': Rpc<TokenRefreshRequestPayload, TokenPayload>
  'api.open': Rpc<ApiOpenPayload, OpenPayload>
  'api.save': Rpc<ApiSavePayload, SaveResult>
  'api.saveAs': Rpc<ApiSaveAsPayload, SaveResult>
  'api.recents': Rpc<ApiRecentsPayload, ApiRecentsResult>
  'api.export': Rpc<ApiExportPayload, ApiExportResult>
  'api.attachments.add': Rpc<ApiAttachmentsAddPayload, ApiAttachmentsAddResult>
  'api.images.upload': Rpc<ApiImageUploadPayload, ApiImageUploadResult>
  /** UniWork file picker (desktop: native open dialog) */
  'file.pick': Rpc<FilePickPayload, FilePickResult>
  /** fetch a remote image for insertion (frame CSP blocks arbitrary origins) */
  'image.fetch': Rpc<ImageFetchPayload, ImageFetchResult>
  /** HTML altChunk -> docx bytes (desktop: main-process converter) */
  'convert.altChunkHtml': Rpc<ConvertAltChunkHtmlPayload, ConvertAltChunkHtmlResult>
}

/** Events the frame sends to the host. */
export interface FrameEvents {
  /** handshake: the frame booted and listens; the host answers with `init` */
  ready: ReadyPayload
  dirty: DirtyPayload
  title: TitlePayload
  /** additive (UNI-1013 F4): a frame modal is open / closed */
  modal: ModalPayload
  resize: ResizePayload
  saved: SavedPayload
  error: ErrorEventPayload
  /** frame aborts a frame->host request */
  cancel: CancelPayload
}

export type HostRequestType = keyof HostRequests
export type HostEventType = keyof HostEvents
export type FrameRequestType = keyof FrameRequests
export type FrameEventType = keyof FrameEvents

/** Every typed message the host may send. */
export type HostToFrameMessage =
  | { [K in HostRequestType]: RequestEnvelope<K, HostRequests[K]['payload']> }[HostRequestType]
  | { [K in FrameRequestType]: ResponseEnvelope<K, FrameRequests[K]['result']> }[FrameRequestType]
  | { [K in HostEventType]: EventEnvelope<K, HostEvents[K]> }[HostEventType]

/** Every typed message the frame may send. */
export type FrameToHostMessage =
  | { [K in FrameRequestType]: RequestEnvelope<K, FrameRequests[K]['payload']> }[FrameRequestType]
  | { [K in HostRequestType]: ResponseEnvelope<K, HostRequests[K]['result']> }[HostRequestType]
  | { [K in FrameEventType]: EventEnvelope<K, FrameEvents[K]> }[FrameEventType]

export type ProtocolMessage = HostToFrameMessage | FrameToHostMessage

// Record<K, true> makes a missing/extra type a compile error; the arrays are derived.
const HOST_REQUESTS: Record<HostRequestType, true> = {
  init: true,
  open: true,
  save: true,
  saveAs: true,
  print: true,
  'doc.closeCheck': true,
}
const HOST_EVENTS: Record<HostEventType, true> = {
  'token.update': true,
  theme: true,
  language: true,
  cancel: true,
  'file.renamed': true,
}
const FRAME_REQUESTS: Record<FrameRequestType, true> = {
  'token.refresh': true,
  'api.open': true,
  'api.save': true,
  'api.saveAs': true,
  'api.recents': true,
  'api.export': true,
  'api.attachments.add': true,
  'api.images.upload': true,
  'file.pick': true,
  'image.fetch': true,
  'convert.altChunkHtml': true,
}
const FRAME_EVENTS: Record<FrameEventType, true> = {
  ready: true,
  dirty: true,
  title: true,
  modal: true,
  resize: true,
  saved: true,
  error: true,
  cancel: true,
}
export const HOST_REQUEST_TYPES = Object.keys(HOST_REQUESTS) as readonly HostRequestType[]
export const HOST_EVENT_TYPES = Object.keys(HOST_EVENTS) as readonly HostEventType[]
export const FRAME_REQUEST_TYPES = Object.keys(FRAME_REQUESTS) as readonly FrameRequestType[]
export const FRAME_EVENT_TYPES = Object.keys(FRAME_EVENTS) as readonly FrameEventType[]

// ---------------------------------------------------------------- runtime validation (hand-written, no deps)

type Obj = Record<string, unknown>

const MAX_ID_LENGTH = 128
const MAX_TYPE_LENGTH = 64

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
function isStr(x: unknown): x is string {
  return typeof x === 'string'
}
function isNonEmptyStr(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0
}
function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}
function isBool(x: unknown): x is boolean {
  return typeof x === 'boolean'
}
function isOpt<T>(x: unknown, guard: (y: unknown) => y is T): boolean {
  return x === undefined || guard(x)
}
function isBuffer(x: unknown): x is ArrayBuffer {
  return x instanceof ArrayBuffer || Object.prototype.toString.call(x) === '[object ArrayBuffer]'
}
function isTheme(x: unknown): x is Theme {
  return x === 'light' || x === 'dark'
}

export function isProtocolErrorShape(x: unknown): x is ProtocolErrorShape {
  return (
    isObj(x) &&
    isStr(x.code) &&
    (PROTOCOL_ERROR_CODES as readonly string[]).includes(x.code) &&
    isStr(x.message) &&
    isOpt(x.retryable, isBool) &&
    isOpt(x.status, isFiniteNum) &&
    isOpt(x.details, isObj)
  )
}

export function isCapabilities(x: unknown): x is Capabilities {
  // unknown keys are tolerated (additive evolution) but every value must be boolean
  return isObj(x) && Object.values(x).every(isBool)
}

export function isTokenPayload(x: unknown): x is TokenPayload {
  return isObj(x) && isNonEmptyStr(x.token) && isFiniteNum(x.tokenExpiresAt)
}

export function isFileMeta(x: unknown): x is FileMeta {
  return (
    isObj(x) &&
    isNonEmptyStr(x.fileId) &&
    isStr(x.name) &&
    isOpt(x.sizeBytes, isFiniteNum) &&
    isOpt(x.mimeType, isStr) &&
    isOpt(x.versionId, isStr) &&
    isOpt(x.etag, isStr) &&
    isOpt(x.modifiedAt, isFiniteNum) &&
    isOpt(x.writable, isBool)
  )
}

export function isFileSource(x: unknown): x is FileSource {
  if (!isObj(x)) return false
  if (x.kind === 'url') {
    return (
      isNonEmptyStr(x.url) &&
      (x.headers === undefined || (isObj(x.headers) && Object.values(x.headers).every(isStr)))
    )
  }
  return x.kind === 'bytes' && isBuffer(x.data)
}

export function isOpenPayload(x: unknown): x is OpenPayload {
  return isObj(x) && isFileMeta(x.file) && isFileSource(x.source)
}

export function isReadyPayload(x: unknown): x is ReadyPayload {
  return (
    isObj(x) &&
    isFiniteNum(x.protocolVersion) &&
    isOpt(x.frameVersion, isStr) &&
    isCapabilities(x.capabilities) &&
    isOpt(x.instanceId, isStr)
  )
}

export function isInitPayload(x: unknown): x is InitPayload {
  return (
    isTokenPayload(x) &&
    isObj(x) &&
    isFiniteNum(x.protocolVersion) &&
    isNonEmptyStr(x.documentId) &&
    isNonEmptyStr(x.workspaceId) &&
    isNonEmptyStr(x.apiBase) &&
    (x.apiMode === 'host-proxy' || x.apiMode === 'direct') &&
    isNonEmptyStr(x.locale) &&
    isTheme(x.theme) &&
    isCapabilities(x.capabilities) &&
    isOpt(x.open, isOpenPayload)
  )
}

export function isInitAck(x: unknown): x is InitAck {
  return (
    isObj(x) &&
    isFiniteNum(x.protocolVersion) &&
    isOpt(x.frameVersion, isStr) &&
    isCapabilities(x.capabilities)
  )
}

export function isSaveResult(x: unknown): x is SaveResult {
  if (!isObj(x)) return false
  if (x.ok === true) return isFileMeta(x.file) && isOpt(x.versionId, isStr)
  return x.ok === false && isProtocolErrorShape(x.error)
}

function isUploadItem(x: unknown): x is UploadItem {
  return isObj(x) && isStr(x.name) && isStr(x.mimeType) && isBuffer(x.data)
}

const anyObj = (x: unknown): boolean => isObj(x)

/**
 * Payload validators keyed by `${kind}:${type}`. Request/event entries check
 * `payload`; response entries check a successful response's `payload`.
 * Types without an entry only need an object payload.
 */
const PAYLOAD_VALIDATORS: Record<string, (x: unknown) => boolean> = {
  // host -> frame requests
  'request:init': isInitPayload,
  'request:open': isOpenPayload,
  'request:save': (x) =>
    isObj(x) && (x.reason === 'user' || x.reason === 'navigate' || x.reason === 'autosave'),
  'request:saveAs': (x) => isObj(x) && isOpt(x.name, isStr),
  'request:print': (x) =>
    isObj(x) && (x.mode === undefined || x.mode === 'dialog' || x.mode === 'pdf'),
  'request:doc.closeCheck': (x) => isObj(x),
  // host -> frame events
  'event:file.renamed': (x) => isObj(x) && isFileMeta(x.file),
  'event:token.update': isTokenPayload,
  'event:theme': (x) => isObj(x) && isTheme(x.theme),
  'event:language': (x) => isObj(x) && isNonEmptyStr(x.locale),
  'event:cancel': (x) => isObj(x) && isNonEmptyStr(x.id),
  // frame -> host requests
  'request:token.refresh': (x) =>
    isObj(x) && (x.reason === 'expiring' || x.reason === 'unauthorized'),
  'request:api.open': (x) => isObj(x) && isNonEmptyStr(x.fileId),
  'request:api.save': (x) =>
    isObj(x) &&
    isNonEmptyStr(x.fileId) &&
    isBuffer(x.data) &&
    isOpt(x.etag, isStr) &&
    isOpt(x.auto, isBool),
  'request:api.saveAs': (x) =>
    isObj(x) &&
    isNonEmptyStr(x.name) &&
    isBuffer(x.data) &&
    isOpt(x.sourceFileId, isStr) &&
    isOpt(x.folderId, isStr) &&
    isOpt(x.silent, isBool),
  'request:api.recents': (x) => isObj(x) && isOpt(x.limit, isFiniteNum),
  'request:api.export': (x) =>
    isObj(x) &&
    (x.format === 'pdf' || x.format === 'html') &&
    isOpt(x.fileId, isStr) &&
    isOpt(x.data, isBuffer) &&
    isOpt(x.html, isStr),
  'request:api.attachments.add': (x) =>
    isObj(x) && Array.isArray(x.files) && x.files.every(isUploadItem),
  'request:api.images.upload': (x) => isObj(x) && isUploadItem(x) && isOpt(x.fileId, isStr),
  'request:file.pick': (x) =>
    isObj(x) &&
    (x.purpose === 'open' || x.purpose === 'insert') &&
    (x.accept === undefined || (Array.isArray(x.accept) && x.accept.every(isStr))),
  'request:image.fetch': (x) => isObj(x) && isNonEmptyStr(x.url) && /^https?:\/\//i.test(x.url),
  'request:convert.altChunkHtml': (x) => isObj(x) && isStr(x.html),
  // frame -> host events
  'event:ready': isReadyPayload,
  'event:dirty': (x) => isObj(x) && isBool(x.dirty),
  'event:title': (x) => isObj(x) && isStr(x.title),
  'event:modal': (x) => isObj(x) && isBool(x.open),
  'event:resize': (x) => isObj(x) && isFiniteNum(x.height) && x.height >= 0,
  'event:saved': (x) =>
    isObj(x) && isFileMeta(x.file) && isOpt(x.versionId, isStr) && isBool(x.initiatedByFrame),
  'event:error': (x) => isObj(x) && isProtocolErrorShape(x.error) && isBool(x.fatal),
  // successful responses
  'response:init': isInitAck,
  'response:open': (x) => isObj(x) && x.opened === true && isOpt(x.title, isStr),
  'response:save': isSaveResult,
  'response:saveAs': isSaveResult,
  'response:print': (x) => isObj(x) && isBool(x.printed),
  'response:token.refresh': isTokenPayload,
  'response:api.open': isOpenPayload,
  'response:api.save': isSaveResult,
  'response:api.saveAs': isSaveResult,
  'response:api.recents': (x) => isObj(x) && Array.isArray(x.files) && x.files.every(isFileMeta),
  'response:api.export': (x) =>
    isObj(x) && isBuffer(x.data) && isStr(x.mimeType) && isOpt(x.name, isStr),
  'response:api.attachments.add': (x) =>
    isObj(x) &&
    Array.isArray(x.accepted) &&
    x.accepted.every(anyObj) &&
    Array.isArray(x.rejected) &&
    x.rejected.every(isStr),
  'response:api.images.upload': (x) => isObj(x) && isNonEmptyStr(x.imageId) && isNonEmptyStr(x.url),
  'response:doc.closeCheck': (x) => isObj(x) && isBool(x.dirty) && isBool(x.autoSave),
  'response:file.pick': (x) => isObj(x) && (x.file === null || isOpenPayload(x.file)),
  'response:image.fetch': (x) =>
    isObj(x) &&
    (x.image === null || (isObj(x.image) && isStr(x.image.base64) && isStr(x.image.mime))),
  'response:convert.altChunkHtml': (x) => isObj(x) && (x.data === null || isBuffer(x.data)),
}

/** Outcome of `parseEnvelope`. */
export type ParseResult =
  | { ok: true; message: Envelope }
  /** not our traffic at all (no/other `ns`); drop silently */
  | { ok: false; reason: 'foreign' }
  /** ours but structurally invalid; `partial` carries id/kind/type when readable */
  | { ok: false; reason: 'malformed'; detail: string; partial?: Partial<Envelope> }
  /** well-formed envelope from a peer on another PROTOCOL_VERSION */
  | { ok: false; reason: 'version_mismatch'; message: Envelope }

/** True for anything carrying our namespace tag, valid or not. */
export function isOwnTraffic(data: unknown): boolean {
  return isObj(data) && data.ns === PROTOCOL_NS
}

/**
 * Validate an incoming `MessageEvent.data`. Checks the envelope, the version,
 * and (for known types) the payload shape. Unknown `type`s pass so the
 * endpoint can answer them with `unknown_type`.
 */
export function parseEnvelope(data: unknown): ParseResult {
  if (!isOwnTraffic(data)) return { ok: false, reason: 'foreign' }
  const d = data as Obj
  const partial: Partial<Envelope> = {}
  if (isNonEmptyStr(d.id) && d.id.length <= MAX_ID_LENGTH) partial.id = d.id
  if (d.kind === 'request' || d.kind === 'response' || d.kind === 'event') partial.kind = d.kind
  if (isNonEmptyStr(d.type) && d.type.length <= MAX_TYPE_LENGTH) partial.type = d.type
  const bad = (detail: string): ParseResult => ({ ok: false, reason: 'malformed', detail, partial })

  if (!isFiniteNum(d.v) || !Number.isInteger(d.v) || d.v < 1) return bad('missing or invalid v')
  if (partial.id === undefined) return bad('missing or invalid id')
  if (partial.kind === undefined) return bad('missing or invalid kind')
  if (partial.type === undefined) return bad('missing or invalid type')
  if (d.error !== undefined && (partial.kind !== 'response' || !isProtocolErrorShape(d.error))) {
    return bad('invalid error')
  }

  const message: Envelope = {
    ns: PROTOCOL_NS,
    v: d.v,
    id: partial.id,
    kind: partial.kind,
    type: partial.type,
  }
  if ('payload' in d) message.payload = d.payload
  if (d.error !== undefined) message.error = d.error as ProtocolErrorShape

  if (d.v !== PROTOCOL_VERSION) return { ok: false, reason: 'version_mismatch', message }

  if (message.kind !== 'response' || message.error === undefined) {
    const validate = PAYLOAD_VALIDATORS[`${message.kind}:${message.type}`]
    if (validate ? !validate(message.payload) : !isObj(message.payload)) {
      return bad(`invalid payload for ${message.kind} ${message.type}`)
    }
  }
  return { ok: true, message }
}

/** Type guards over a parsed envelope. */
export function isRequest(m: Envelope): m is RequestEnvelope {
  return m.kind === 'request'
}
export function isResponse(m: Envelope): m is ResponseEnvelope {
  return m.kind === 'response'
}
export function isEvent(m: Envelope): m is EventEnvelope {
  return m.kind === 'event'
}
