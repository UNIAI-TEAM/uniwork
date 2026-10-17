// Vendored from the genoffice fork (UNIAI-TEAM/uniwork-office),
// web/docs/protocol/types.ts at 07605ced5e14733de4fa28d57c1bec967b605973
// (fork SIZE-F1 integration branch feature/UNI-1861-size-f1 at 07605ced5: document size limits, size_warning,
// save_blocked, doc.download, lag_detected, open_refused; additive over bf4ff7b07; re-vendor from fork main once SIZE-F1 lands there).
// Byte-identical except the relative import specifiers (./types -> ./docs-frame-protocol, ./endpoint -> ./docs-frame-endpoint).
// Do not edit here: change the fork, re-vendor, update this SHA.
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
  /** semantically invalid argument (HTTP 422, e.g. principal_not_in_organization) */
  | 'invalid_arg'
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
  'invalid_arg',
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

/**
 * Which genoffice editor a frame bundle is (lane GO-B4/B5/B6, additive). One protocol serves every
 * module; `ready.module` says what the frame is and `init.module` what the host opens in it. Absent
 * on either side means 'docs' (frames and hosts from before the field existed).
 */
export type OfficeModule = 'docs' | 'pdf' | 'markdown' | 'html' | 'slides' | 'sheets'

export const OFFICE_MODULES: readonly OfficeModule[] = [
  'docs',
  'pdf',
  'markdown',
  'html',
  'slides',
  'sheets',
]

/** absent = 'docs' */
export const DEFAULT_OFFICE_MODULE: OfficeModule = 'docs'

export function isOfficeModule(x: unknown): x is OfficeModule {
  return typeof x === 'string' && (OFFICE_MODULES as readonly string[]).includes(x)
}

/** the module a `ready` / `init` payload names (absent = 'docs') */
export function moduleOf(payload: { module?: OfficeModule } | null | undefined): OfficeModule {
  return payload?.module ?? DEFAULT_OFFICE_MODULE
}

/**
 * Host-side check before `init`: does the frame that said `ready` run the editor for the
 * document's module? Returns the `malformed` error to fail the handshake with, or null when they
 * match. (A docs document never opens in the PDF frame, whatever URL the frame was loaded from.)
 */
export function checkFrameModule(
  ready: { module?: OfficeModule },
  expected: OfficeModule,
): DocsProtocolError | null {
  const frame = moduleOf(ready)
  if (frame === expected) return null
  return new DocsProtocolError({
    code: 'malformed',
    message: `frame module "${frame}" cannot open a "${expected}" document`,
    details: { frameModule: frame, expectedModule: expected },
  })
}

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
  /**
   * AI panels (GO-A7 web AI contract, CONTRACT C16): the frame calls the frame-token AI routes
   * itself (/office-frame/documents/{id}/ai/...). Grant it only when the org entitlement and those
   * routes are live; without it every AI entry stays hidden.
   */
  | 'ai'
  /** additive (C16): UniWork cloud web search for the AI tools; effective only together with `ai` */
  | 'webSearch'
  /** additive (C16): UniWork cloud image search for the AI tools; effective only together with `ai` */
  | 'imageSearch'
  /** additive (C16): UniWork cloud image generation (and media analysis); effective only with `ai` */
  | 'imageGeneration'
  /**
   * additive (A7 contract): the host can run its own "Open in desktop app" flow for the frame's
   * `app.open` request. Default false; granted only when the host's own action is available. Without
   * it the frame shows the "use the app" message only.
   */
  | 'desktopOpen'
  /**
   * additive (X-02): the host installed `api.download` (it names, types, size-checks and delivers
   * the frame's bytes itself). Advertise it in `init` only then; the frame offers a download only
   * when the effective capabilities have it.
   */
  | 'download'
  /**
   * additive (X-02): UniWork AI (the cloud agent behind the org entitlement) in the frame's AI panel.
   * The frame claims it once it has the adapter (G6-05); effective = host grant AND frame claim.
   */
  | 'uniworkAi'
  /**
   * additive (G8-08): server comments (contract-collab §10). The host advertises it only for a
   * document bound to UniWork whose user has at least `view`, and then MUST send
   * `InitPayload.commentsLevel`. The frame sends `comments.*` / `mentions.search` only when the
   * effective capabilities have it; without it the editor hides its server comment mode.
   */
  | 'comments'
  /**
   * additive (G8-18): the host can grant view access to mentioned users via `comments.shareView`.
   * The frame offers "Share view access" actions only when the effective capabilities have it AND
   * the server sets `can_share: true`.
   */
  | 'commentsShareView'
  /**
   * additive (SIZE-F1): the host renders its own size warning banner and save-blocked modal from
   * `size_warning` / `save_blocked` events and triggers downloads via `doc.download`. When false or
   * absent, the frame renders its own fallback warning chip and save-blocked dialog.
   */
  | 'sizeUi'

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
  'webSearch',
  'imageSearch',
  'imageGeneration',
  'desktopOpen',
  'download',
  'uniworkAi',
  'comments',
  'commentsShareView',
  'sizeUi',
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
  /**
   * additive (X-02): the document revision of exactly these bytes, a decimal string (compare as
   * BigInt, never as text). Absent from hosts before X-02: show no number then.
   */
  revision?: string
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
  /** the editor this bundle runs (additive, GO-B4/B5/B6); absent = 'docs' */
  module?: OfficeModule
}

export interface InitPayload extends TokenPayload {
  protocolVersion: number
  documentId: string
  workspaceId: string
  /** absolute API origin + prefix, e.g. "https://uniworkos.com/api" */
  apiBase: string
  apiMode: ApiMode
  /** BCP-47, e.g. "vi", "en" */
  locale: string
  theme: Theme
  capabilities: Capabilities
  /** optional: open this immediately (saves a round-trip vs. a later `open`) */
  open?: OpenPayload
  /**
   * the document's module (additive, GO-B4/B5/B6); absent = 'docs'. A frame running another
   * module refuses the `init` with `malformed`.
   */
  module?: OfficeModule
  /**
   * the signed-in user as editors show them (additive, GO-B4: PDF note author, comment author).
   * Display data only, never an identity the frame may authorise with.
   */
  user?: InitUser
  /**
   * web draft recovery (additive, CONTRACT C18). Absent = recovery off (the frame shows nothing).
   */
  recovery?: InitRecovery
  /**
   * additive (X-02 r2b): the largest file, in bytes, the host's `api.download` accepts for this
   * document. A positive safe integer; sent only together with the `download` capability. The
   * frame disables its "download my version" choice up front when its version is larger (equal
   * is allowed). Absent = the choice is disabled only after a `too_large` answer.
   */
  downloadMaxBytes?: number
  /**
   * additive (G8-08, OQ-C12): the caller's effective document level (the server's `my_level`), a
   * display hint for the comment panel only; the server stays the only permission gate. Required
   * whenever `capabilities.comments` is granted (`checkInitComments`, host side). The frame never
   * rejects an init over it: a missing, unknown (a future level) or null value is treated as
   * missing and the missing-field rules of `commentsAccess` apply.
   */
  commentsLevel?: CommentsLevel
  /**
   * additive (SIZE-F1): document size limits for this session. Invalid or missing fields fall back
   * independently to DEFAULT_DOCUMENT_LIMITS via resolveDocumentSizeLimits and never fail init.
   */
  limits?: DocumentSizeLimits
}

/**
 * Document size limits (additive, SIZE-F1, UNI-1861).
 */
export interface DocumentSizeLimits {
  /** Hard ceiling on serialized document bytes for open and save. Must be an integer >= 1. */
  max_bytes: number
  /** Warning threshold as a fraction of max_bytes. Must satisfy 0 < warn_ratio < 1. */
  warn_ratio: number
}

export const DEFAULT_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024 // 209_715_200
export const DEFAULT_DOCUMENT_WARN_RATIO = 0.9

export const DEFAULT_DOCUMENT_LIMITS: DocumentSizeLimits = {
  max_bytes: DEFAULT_DOCUMENT_MAX_BYTES,
  warn_ratio: DEFAULT_DOCUMENT_WARN_RATIO,
}

/**
 * Lenient field-by-field resolution of DocumentSizeLimits (SIZE-F1).
 * Invalid or missing fields fall back independently to `fallback` (default: DEFAULT_DOCUMENT_LIMITS)
 * and never reject `init` or `open`.
 */
export function resolveDocumentSizeLimits(
  raw?: unknown,
  fallback: DocumentSizeLimits = DEFAULT_DOCUMENT_LIMITS,
): DocumentSizeLimits {
  const rec =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined
  const maxBytes =
    rec &&
    typeof rec.max_bytes === 'number' &&
    Number.isSafeInteger(rec.max_bytes) &&
    rec.max_bytes >= 1
      ? rec.max_bytes
      : fallback.max_bytes
  const warnRatio =
    rec &&
    typeof rec.warn_ratio === 'number' &&
    Number.isFinite(rec.warn_ratio) &&
    rec.warn_ratio > 0 &&
    rec.warn_ratio < 1
      ? rec.warn_ratio
      : fallback.warn_ratio
  return { max_bytes: maxBytes, warn_ratio: warnRatio }
}

export const resolveDocumentLimits = resolveDocumentSizeLimits

/**
 * The host's draft-recovery grant: the frame encrypts its local IndexedDB draft copies
 * ("uniwork-office-frame-drafts") with `key` and keys them by `scope`.
 */
export interface InitRecovery {
  /**
   * AES-GCM 256, generated by the host with extractable=false and persisted per user in the
   * frame-drafts IndexedDB ("keys" store, C18a), passed by structured clone (again in a later
   * init after a reload)
   */
  key: CryptoKey
  /** "<userId>:<documentId>", opaque to the frame */
  scope: string
}

export interface InitUser {
  displayName: string
  /**
   * additive (G8-08): the UniWork user id, only to recognise "my comments" (author_id). Never an
   * identity the frame may authorise with. The frame treats an empty or non-string value as absent
   * and never rejects the init over it.
   */
  id?: string
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
  /**
   * relative resource path (as written in the document, e.g. "assets/x.png") -> URL the frame may
   * load it from (additive, GO-B4: Markdown/HTML documents with relative images). Same rules as
   * `FileSource {kind:'url'}`: same-origin with the frame (CSP), fetched with credentials: 'omit'.
   */
  assets?: Record<string, string>
  /**
   * additive (SIZE-F1): per-open override of DocumentSizeLimits. Precedence:
   * open.limits ?? init.limits ?? DEFAULT_DOCUMENT_LIMITS.
   */
  limits?: DocumentSizeLimits
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
  /**
   * additive (X-02, OQ-P3): the version the frame wants (`doc.remoteVersion.version_id`). The host
   * still answers with the head: when this version is no longer the head it sets
   * `ApiOpenResult.versionChanged`; an unknown version or one of another document is refused with
   * `not_found`. A host before X-02 ignores the key and answers the latest without `revision`.
   */
  versionId?: string
}

/**
 * The `api.open` answer: always the head, its bytes and its `file.revision` from one read (never
 * an older version's bytes with the head revision).
 */
export interface ApiOpenResult extends OpenPayload {
  /** additive (X-02, OQ-P3): the asked `versionId` was no longer the head; requires `file.revision` */
  versionChanged?: boolean
}

/** a document revision on the wire: a non-negative decimal integer string */
export function isDecimalRevision(x: unknown): x is string {
  return typeof x === 'string' && x.length <= 20 && /^(0|[1-9][0-9]*)$/.test(x)
}

/**
 * The revision the frame may show and save on after an `api.open`: the reply's own, never the one
 * it asked for. null = a host before X-02 (no number: the "updated" bar without a revision).
 */
export function openReplyRevision(reply: Pick<OpenPayload, 'file'>): string | null {
  return isDecimalRevision(reply.file.revision) ? reply.file.revision : null
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

/**
 * additive (X-02): hand the open bytes to the host to download (send only with the `download`
 * capability). Bytes only: the host picks the name, extension, MIME type and size limit, checks
 * the permission and delivers them from its own origin. Refusals use existing codes
 * (`malformed`, `too_large`, `forbidden`); a host before X-02 answers `unknown_type`.
 */
export interface ApiDownloadPayload {
  data: ArrayBuffer
}

export interface ApiDownloadResult {
  /** the host gave the file to the browser (not: the user saved it) */
  delivered: true
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

/**
 * additive (X-02): a new version of a document was saved elsewhere. Field names are the server's.
 * The frame ignores an event for another `document_id`; it reloads through `api.open` and takes
 * the revision from that reply, never from this event.
 */
export interface RemoteVersionPayload {
  document_id: string
  /** decimal string */
  revision: string
  version_id: string
  /** ISO 8601 */
  saved_at: string
  /** only when the viewer may see members; absent = "a member" */
  author_name?: string
}

/** Why the host blocks the open document; a frame treats a value it does not know as `permission_revoked`. */
export type DocBlockedReason =
  | 'permission_revoked'
  | 'document_deleted'
  | 'organization_suspended'
  | 'member_deactivated'
  | 'document_archived'

/**
 * additive (G5-03w): the host learned that the open document can no longer be saved by this viewer
 * (access revoked, deleted, organisation suspended, member deactivated, archived). The frame ignores
 * it for another `document_id`; for its own it shows the reason's error bar, keeps the content
 * (dirty edits included) read-only and refuses every Save / Save As. The host keeps refusing
 * `api.save` / `api.saveAs` by itself, so a frame without a listener loses nothing but the early bar.
 */
export interface DocBlockedPayload {
  document_id: string
  /** validated as a non-empty string so a reason a newer host adds still reaches the frame */
  reason: DocBlockedReason
}

export type AiRunState = 'running' | 'idle'

/**
 * additive (X-02): an AI turn (UniWork AI, BYOK, CLI) started (`running`) or ended (`idle`, exactly
 * once per turn). The emit rules and end paths live in EXPERIENCE.md › Foundation; a host treats the
 * turn as idle when the frame unloads.
 */
export interface AiRunPayload {
  state: AiRunState
  run_id?: string
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

export interface AppOpenPayload {
  /** short opaque tag (e.g. "pdf.ocr") for the host's own dev diagnostics; never shown, never sent to a server */
  feature?: string
}

/** launched = the browser tab hid after the deep link; installer = the install prompt opened; unavailable = no launch possible (the host shows its own alert) */
export type AppOpenOutcome = 'launched' | 'installer' | 'unavailable'

export const APP_OPEN_OUTCOMES: readonly AppOpenOutcome[] = ['launched', 'installer', 'unavailable']

export interface AppOpenResult {
  outcome: AppOpenOutcome
}

export interface ApiAssetsResolvePayload {
  /** the open document (default: the document of the frame's token) */
  fileId?: string
  /** relative paths as written in the document ("assets/x.png", "./img/y.svg") (1..50) */
  paths: string[]
}

export interface ApiAssetsResolveResult {
  /** path as sent -> URL, with the rules of `OpenPayload.assets`; a path that resolves to nothing is absent */
  assets: Record<string, string>
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

// ---------------------------------------------------------------- comments (additive, G8-08)

/**
 * Server comments through the host (contract-collab §2, §3, §4, §6, §9, §10). Field names are the
 * server's (snake_case): the host forwards the UniWork API bodies unchanged, so a comment body
 * (Markdown subset + `[@Label](mention://member/<ULID>)` tokens) reaches the other side byte for
 * byte. Send only with the effective `comments` capability.
 */
export type CommentsLevel = 'view' | 'comment' | 'edit' | 'manage'

export const COMMENTS_LEVELS: readonly CommentsLevel[] = ['view', 'comment', 'edit', 'manage']

export type CommentKind = 'comment' | 'discussion'

export const COMMENT_KINDS: readonly CommentKind[] = ['comment', 'discussion']

export type CommentAnchorState = 'exact' | 'stale' | 'lost'

/**
 * A value read from the server that may be newer than this file: the known literals autocomplete,
 * any other string is tolerated (the row is kept; the frame UI renders only the kinds it knows).
 */
export type OpenString<T extends string> = T | (string & Record<never, never>)

/** `comments.anchors` accepts at most this many items (OQ-C5) */
export const COMMENTS_MAX_ANCHORS = 500

/**
 * A `comments.reveal` that arrives before the first successful `comments.list` is held at most this
 * long, then answered `not_ready` (retryable) — always before the host's own timeout (§10).
 */
export const COMMENTS_REVEAL_WAIT_MS = 10_000

/** the host never sends `comments.reveal` with a shorter timeout than this (§10) */
export const COMMENTS_REVEAL_MIN_TIMEOUT_MS = 15_000

/** the host's single reveal retry runs after this delay or on `comments.changed`, whichever first */
export const COMMENTS_REVEAL_RETRY_MS = 2_000

/**
 * A position in the document (§4.1): `format` + `v`, then the per-format keys (docx: para_id?,
 * path, start, end, quote, prefix, suffix; xlsx: sheet, range; pptx: slide_id, slide_index,
 * object_id?; pdf: page, rect). The server owns the closed schema; the protocol checks the frame.
 */
export interface CommentAnchor {
  format: string
  v: number
  [key: string]: unknown
}

/** `CommentMentionWithoutAccessDTO` (G8-18): a mentioned user who cannot view the document */
export interface CommentMentionWithoutAccess {
  user_id: string
  display_name?: string
  can_share: boolean
}

/** `DocumentCommentDTO` (§2.1). Keys a newer server adds pass through. */
export interface DocumentComment {
  id: string
  document_id: string
  /** null: a system / AI author the server may emit without an id (never `mine`) */
  author_id?: string | null
  author_kind?: string
  author?: unknown
  parent_id?: string | null
  /** '' for a tombstone */
  body: string
  /** absent only from servers before G8; an unknown value is kept and not rendered by the frame */
  kind?: OpenString<CommentKind>
  /** legacy field kept for old clients; read `kind` */
  type?: string
  revision?: number
  anchor?: CommentAnchor | null
  anchor_version_id?: string | null
  anchor_state?: OpenString<CommentAnchorState> | null
  resolved_at?: string | null
  /** set = a tombstone ("the content was deleted") */
  deleted_at?: string | null
  deleted_by_id?: string | null
  deleted_by_kind?: string | null
  created_at?: string
  updated_at?: string
  display_name?: string
  avatar_url?: string
  reactions?: unknown
  /** additive (G8-18): mentioned users in this comment who currently lack view access */
  mentions_without_access?: CommentMentionWithoutAccess[]
  [key: string]: unknown
}

/** `DocumentCommentMentionDTO`: the current name of an id used in a mention token */
export interface CommentMention {
  user_id: string
  /** present when state = 'ok' */
  display_name?: string
  avatar_url?: string
  /** 'unavailable': show the token label, no link */
  state: 'ok' | 'unavailable'
}

export interface CommentsListPayload {
  kind?: CommentKind
  /** the `list_token` that came with the list the frame holds */
  since_token?: string
}

/**
 * `unchanged: true` (since_token = the current token): keep the comments and mentions held,
 * `comments`/`mentions` are empty. Otherwise replace the whole list (a hard-deleted thread is
 * gone); never infer a deletion from a missing row.
 */
export interface CommentsListResult {
  comments: DocumentComment[]
  mentions: CommentMention[]
  list_token: string
  unchanged: boolean
}

export interface CommentsCreatePayload {
  kind: CommentKind
  parent_id?: string
  body: string
  /** root `comment` threads only; requires `base_version_id` */
  anchor?: CommentAnchor
  /** the version the editor has open or just saved */
  base_version_id?: string
}

export interface CommentIdPayload {
  comment_id: string
}

export interface CommentsUpdatePayload extends CommentIdPayload {
  body: string
}

export interface CommentResult {
  comment: DocumentComment
}

export interface CommentsDeleteResult {
  /** tombstoned: it has replies, a frame stays; removed: gone */
  outcome: 'tombstoned' | 'removed'
}

export interface CommentRevision {
  id: string
  revision: number
  body: string
  /** null: a system / AI author without an id */
  created_by_id: string | null
  created_by_kind: string
  created_at: string
}

export interface CommentsRevisionsResult {
  /** newest first */
  revisions: CommentRevision[]
}

export interface CommentAnchorUpdate {
  comment_id: string
  anchor: CommentAnchor
  /** the editor only reports found / not found; the server derives `stale` */
  state: 'exact' | 'lost'
}

/** after a save receipt: re-anchor the root comments to `version_id` */
export interface CommentsAnchorsPayload {
  version_id: string
  anchors: CommentAnchorUpdate[]
}

export interface CommentsAnchorsResult {
  updated: string[]
  skipped: Array<{ comment_id: string; reason: 'older_version' | 'not_applicable' }>
  /** never use it as a since_token: reload the full list when `updated` is not empty */
  list_token: string
}

export interface MentionsSearchPayload {
  /** '' = by name */
  q: string
  limit?: number
  /** additive (G8-18): include workspace members without view access (`can_view: false`) */
  include?: 'no_access'
}

export interface MentionCandidate {
  user_id: string
  display_name: string
  avatar_url?: string
  email?: string
  /** additive (G8-18): false when returned via `include: 'no_access'` for a non-viewer */
  can_view?: boolean
}

export interface MentionsSearchResult {
  candidates: MentionCandidate[]
}

/** additive (G8-18): grant `view` access to a mentioned user; send only with `commentsShareView` */
export interface CommentsShareViewPayload {
  user_id: string
}

export interface CommentsShareViewResult {
  ok: true
}

/** host -> frame: the comments of a document changed elsewhere (ids only) */
export interface CommentsChangedPayload {
  document_id: string
}

export interface CommentsRevealPayload {
  comment_id: string
}

/** false only means "the list is loaded and has no such comment" (the frame shows it itself) */
export interface CommentsRevealResult {
  revealed: boolean
}

const COMMENTS_REQUEST_TYPES: readonly string[] = [
  'comments.list',
  'comments.create',
  'comments.update',
  'comments.delete',
  'comments.resolve',
  'comments.reopen',
  'comments.revisions',
  'comments.anchors',
  'comments.shareView',
  'mentions.search',
]

/** the frame -> host requests that need the `comments` capability */
export function isCommentsRequestType(type: string): boolean {
  return COMMENTS_REQUEST_TYPES.includes(type)
}

/**
 * The fixed UniWork API -> protocol error table for `comments.*` / `mentions.search` (§9), shared by
 * every host (desktop main, web host). `status` 0 = no HTTP response (fetch failed, offline,
 * connection timeout). `body` is the server's error JSON (`{error: {code}}`, or an already
 * unwrapped `{code}`). A frame reads `details.code` before `code`: `comment_deleted` is a
 * `conflict` that must never take the document reload/retry path.
 */
export function commentsErrorFromHttp(status: number, body?: unknown): DocsProtocolError {
  if (!(status > 0)) {
    return new DocsProtocolError({
      code: 'network',
      message: 'comments: no response from the server',
      retryable: true,
    })
  }
  // §9 names `payload_too_large` for 413 (handler/json.go) even when the limiter answered without
  // the JSON code; every other row is keyed on the server's own code, so none is invented there
  const serverCode = errorBodyCode(body) ?? (status === 413 ? 'payload_too_large' : undefined)
  const maxBytes = status === 413 ? errorBodyMaxBytes(body) : undefined
  const withCode = (code: ProtocolErrorCode): DocsProtocolError => {
    const details: Record<string, unknown> = {}
    if (serverCode) details.code = serverCode
    if (maxBytes !== undefined) details.max_bytes = maxBytes
    return new DocsProtocolError({
      code,
      message: `comments: HTTP ${status}${serverCode ? ` ${serverCode}` : ''}`,
      status,
      retryable: false,
      ...(Object.keys(details).length > 0 ? { details } : {}),
    })
  }
  const plain = (code: ProtocolErrorCode, retryable: boolean): DocsProtocolError =>
    new DocsProtocolError({ code, message: `comments: HTTP ${status}`, status, retryable })
  if (status === 400) return withCode('malformed')
  if (status === 409) return withCode('conflict')
  if (status === 413) return withCode('too_large')
  if (status === 422) return withCode('invalid_arg')
  if (status === 401) return plain('unauthorized', false)
  if (status === 403) return plain('forbidden', false)
  if (status === 404) return plain('not_found', false)
  if (status === 429) return plain('rate_limited', true)
  return plain('internal', status >= 500)
}

function errorBodyCode(body: unknown): string | undefined {
  if (!isObj(body)) return undefined
  const inner = isObj(body.error) ? body.error : body
  return isNonEmptyStr(inner.code) && inner.code.length <= MAX_TYPE_LENGTH ? inner.code : undefined
}

function errorBodyMaxBytes(body: unknown): number | undefined {
  if (!isObj(body)) return undefined
  const inner = isObj(body.error) ? body.error : body
  const fields = isObj(inner.fields) ? inner.fields : isObj(body.fields) ? body.fields : undefined
  if (fields && isPositiveSafeInt(fields.max_bytes)) return fields.max_bytes
  if (isPositiveSafeInt(inner.max_bytes)) return inner.max_bytes
  return undefined
}

/**
 * Host-side check of its own `init`: a host that grants `comments` must send a valid
 * `commentsLevel` (§10). Returns the `malformed` error describing the host bug
 * (`comments_level_missing` / `comments_level_invalid`), or null. The frame never refuses such an
 * init; it treats the level as missing (`commentsAccess` with `level: null`).
 */
export function checkInitComments(
  init: Pick<InitPayload, 'capabilities' | 'commentsLevel'>,
): DocsProtocolError | null {
  if (init.capabilities.comments !== true) return null
  if (init.commentsLevel === undefined) {
    return new DocsProtocolError({
      code: 'malformed',
      message: 'init grants comments without commentsLevel',
      details: { code: 'comments_level_missing' },
    })
  }
  if (isCommentsLevel(init.commentsLevel)) return null
  return new DocsProtocolError({
    code: 'malformed',
    message: 'init grants comments with an invalid commentsLevel',
    details: { code: 'comments_level_invalid' },
  })
}

/** What the comment panel may offer (a display hint; the server is the only permission gate). */
export interface CommentsAccess {
  /** server comment mode shown at all (effective `comments` capability) */
  enabled: boolean
  /** the level in effect; null = the host sent none (composer + own comments only) */
  level: CommentsLevel | null
  /** the composer (new threads and replies) */
  canCreate: boolean
  /** recognises "mine" (InitUser.id), never used for anything else */
  userId?: string
}

export type CommentAction = 'edit' | 'delete' | 'resolve' | 'reopen'

/**
 * The frame's affordance rules (§10, OQ-C12, G8-18): view = nothing that writes; comment =
 * composer, own edit/delete, and resolve/reopen on own root threads only; edit = composer, own
 * edit/delete, resolve/reopen any thread; manage = also edit/delete of others; missing level =
 * composer and actions on own comments, never on others. `forbidden`: a 403 from the server turns
 * the panel read-only. Never probe the level with a write request.
 */
export function commentsAccess(
  session: {
    capabilities: Capabilities
    commentsLevel?: CommentsLevel
    user?: { id?: string }
  },
  opts: { forbidden?: boolean } = {},
): CommentsAccess {
  const enabled = session.capabilities.comments === true
  const level: CommentsLevel | null = opts.forbidden ? 'view' : (session.commentsLevel ?? null)
  const out: CommentsAccess = { enabled, level, canCreate: enabled && level !== 'view' }
  if (session.user?.id) out.userId = session.user.id
  return out
}

export function canActOnComment(
  access: CommentsAccess,
  comment: Pick<DocumentComment, 'author_id' | 'deleted_at'> & {
    thread_author_id?: string | null
  },
  action: CommentAction,
): boolean {
  if (!access.enabled || access.level === 'view' || comment.deleted_at) return false
  const mine = access.userId !== undefined && comment.author_id === access.userId
  const rootAuthor =
    comment.thread_author_id !== undefined ? comment.thread_author_id : comment.author_id
  const ownThread = access.userId !== undefined && rootAuthor === access.userId
  if (access.level === null) {
    return action === 'resolve' || action === 'reopen' ? ownThread : mine
  }
  if (action === 'resolve' || action === 'reopen') {
    return access.level === 'comment' ? ownThread : true
  }
  return access.level === 'manage' || mine
}

// ---------------------------------------------------------------- direction maps

/**
 * additive (SIZE-F1): serialized document size reached warn threshold on save.
 */
export interface SizeWarningPayload {
  /** Serialized document size in bytes that triggered the warning. */
  bytes: number
  /** Active max_bytes limit at the time of evaluation. */
  max_bytes: number
  /** Active warn_ratio at the time of evaluation. */
  warn_ratio: number
}

/**
 * additive (SIZE-F1): save blocked because serialized document size exceeded max_bytes.
 */
export interface SaveBlockedPayload {
  /** Serialized document size in bytes that exceeded max_bytes. */
  bytes: number
  /** Active max_bytes limit that was exceeded. */
  max_bytes: number
}

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
  /**
   * additive (G8-08): scroll the panel to the thread and bring its anchor into view (`lost` /
   * `stale` anchor: open the thread only). Send only after an InitAck with `comments`.
   */
  'comments.reveal': Rpc<CommentsRevealPayload, CommentsRevealResult>
  /**
   * additive (SIZE-F1): host asks the frame to download its current (or last-blocked) document
   * bytes via `api.download`.
   */
  'doc.download': Rpc<Record<string, never>, ApiDownloadResult>
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
  /** additive (X-02): a newer version was saved elsewhere; frames before X-02 have no listener */
  'doc.remoteVersion': RemoteVersionPayload
  /** additive (G8-08): reload the comment list (frames without `comments` have no listener) */
  'comments.changed': CommentsChangedPayload
  /** additive (G5-03w): the open document is blocked (revoked, deleted, …); frames before it have no listener */
  'doc.blocked': DocBlockedPayload
}

/** Requests the frame sends to the host. `api.*` are proxied to UniWork APIs. */
export interface FrameRequests {
  'token.refresh': Rpc<TokenRefreshRequestPayload, TokenPayload>
  'api.open': Rpc<ApiOpenPayload, ApiOpenResult>
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
  /** additive (A7): run the host's "Open in desktop app" flow; send only with the `desktopOpen` capability */
  'app.open': Rpc<AppOpenPayload, AppOpenResult>
  /**
   * additive (A1b, Markdown/HTML frames): fresh URLs for relative paths as written in the document
   * (typed after the open, or the open answer's URLs about to expire). An old host answers
   * `unsupported`; the frame keeps the URLs it has.
   */
  'api.assets.resolve': Rpc<ApiAssetsResolvePayload, ApiAssetsResolveResult>
  /** additive (X-02): download the open bytes; send only with the `download` capability */
  'api.download': Rpc<ApiDownloadPayload, ApiDownloadResult>
  /** additive (G8-08): server comments; send only with the `comments` capability */
  'comments.list': Rpc<CommentsListPayload, CommentsListResult>
  'comments.create': Rpc<CommentsCreatePayload, CommentResult>
  'comments.update': Rpc<CommentsUpdatePayload, CommentResult>
  'comments.delete': Rpc<CommentIdPayload, CommentsDeleteResult>
  'comments.resolve': Rpc<CommentIdPayload, CommentResult>
  'comments.reopen': Rpc<CommentIdPayload, CommentResult>
  'comments.revisions': Rpc<CommentIdPayload, CommentsRevisionsResult>
  'comments.anchors': Rpc<CommentsAnchorsPayload, CommentsAnchorsResult>
  'comments.shareView': Rpc<CommentsShareViewPayload, CommentsShareViewResult>
  'mentions.search': Rpc<MentionsSearchPayload, MentionsSearchResult>
}

/** additive (UNI-1865, §4.1): main-thread lag detected on a large document */
export interface LagDetectedPayload {
  reason: 'interactions' | 'longtask'
  worst_ms: number
  count: number
  window_ms: number
  bytes?: number
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
  /** additive (X-02): an AI turn started / ended; hosts before X-02 have no listener */
  aiRun: AiRunPayload
  /** additive (SIZE-F1): serialized document size reached warn threshold on save */
  size_warning: SizeWarningPayload
  /** additive (SIZE-F1): save blocked because serialized document size exceeded max_bytes */
  save_blocked: SaveBlockedPayload
  /** additive (UNI-1865, §4.1): passive main-thread lag detector tripped (at most once per documentId) */
  lag_detected: LagDetectedPayload
  /** additive (SIZE-F1, contract-size-frame §3.1a): the frame refused to open the document */
  open_refused: OpenRefusedPayload
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
  'comments.reveal': true,
  'doc.download': true,
}
const HOST_EVENTS: Record<HostEventType, true> = {
  'token.update': true,
  theme: true,
  language: true,
  cancel: true,
  'file.renamed': true,
  'doc.remoteVersion': true,
  'comments.changed': true,
  'doc.blocked': true,
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
  'app.open': true,
  'api.assets.resolve': true,
  'api.download': true,
  'comments.list': true,
  'comments.create': true,
  'comments.update': true,
  'comments.delete': true,
  'comments.resolve': true,
  'comments.reopen': true,
  'comments.revisions': true,
  'comments.anchors': true,
  'comments.shareView': true,
  'mentions.search': true,
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
  aiRun: true,
  size_warning: true,
  save_blocked: true,
  lag_detected: true,
  open_refused: true,
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
function isPositiveSafeInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x > 0
}
function isNonNegSafeInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
}
function isWarnRatio(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1
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
    isOpt(x.writable, isBool) &&
    isOpt(x.revision, isDecimalRevision)
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

function isAssetMap(x: unknown): x is Record<string, string> {
  return isObj(x) && Object.entries(x).every(([k, v]) => k.length > 0 && isNonEmptyStr(v))
}

export function isOpenPayload(x: unknown): x is OpenPayload {
  return isObj(x) && isFileMeta(x.file) && isFileSource(x.source) && isOpt(x.assets, isAssetMap)
}

/** `id` is a hint: any value passes here, the frame drops an empty / non-string one (FE-W8P-1) */
function isInitUser(x: unknown): x is InitUser {
  return isObj(x) && isStr(x.displayName)
}

function isOneOf<T extends string>(list: readonly T[]): (x: unknown) => x is T {
  return (x): x is T => typeof x === 'string' && (list as readonly string[]).includes(x)
}
export const isCommentsLevel = isOneOf(COMMENTS_LEVELS)
const isCommentKind = isOneOf(COMMENT_KINDS)
function isOptNullable<T>(x: unknown, guard: (y: unknown) => y is T): boolean {
  return x === undefined || x === null || guard(x)
}
function isArrayOf(x: unknown, guard: (y: unknown) => boolean): x is unknown[] {
  return Array.isArray(x) && x.every(guard)
}

function isCommentAnchor(x: unknown): x is CommentAnchor {
  return isObj(x) && isNonEmptyStr(x.format) && isPositiveSafeInt(x.v)
}

function isCommentMentionWithoutAccess(x: unknown): x is CommentMentionWithoutAccess {
  return isObj(x) && isNonEmptyStr(x.user_id) && isOpt(x.display_name, isStr) && isBool(x.can_share)
}

function isDocumentComment(x: unknown): x is DocumentComment {
  return (
    isObj(x) &&
    isNonEmptyStr(x.id) &&
    isNonEmptyStr(x.document_id) &&
    isStr(x.body) &&
    isOptNullable(x.author_id, isStr) &&
    isOptNullable(x.parent_id, isStr) &&
    isOpt(x.kind, isStr) &&
    isOpt(x.revision, isFiniteNum) &&
    isOptNullable(x.anchor, isCommentAnchor) &&
    isOptNullable(x.anchor_version_id, isStr) &&
    isOptNullable(x.anchor_state, isStr) &&
    isOptNullable(x.resolved_at, isStr) &&
    isOptNullable(x.deleted_at, isStr) &&
    isOpt(x.mentions_without_access, (y): y is CommentMentionWithoutAccess[] =>
      isArrayOf(y, isCommentMentionWithoutAccess),
    )
  )
}

function isCommentMention(x: unknown): x is CommentMention {
  return (
    isObj(x) &&
    isNonEmptyStr(x.user_id) &&
    (x.state === 'ok' || x.state === 'unavailable') &&
    isOpt(x.display_name, isStr) &&
    isOpt(x.avatar_url, isStr)
  )
}

function isCommentRevision(x: unknown): x is CommentRevision {
  return (
    isObj(x) &&
    isNonEmptyStr(x.id) &&
    isFiniteNum(x.revision) &&
    isStr(x.body) &&
    isOptNullable(x.created_by_id, isStr) &&
    isStr(x.created_by_kind) &&
    isStr(x.created_at)
  )
}

/**
 * OQ-C2 (the server enforces the same on create): a root `comment` carries an anchor and the version
 * it was taken from; a reply (`parent_id` set) carries neither; a `discussion` carries no anchor.
 * An anchor without `base_version_id` is invalid everywhere.
 */
function isCommentCreateAnchorShape(x: {
  kind?: unknown
  parent_id?: unknown
  anchor?: unknown
  base_version_id?: unknown
}): boolean {
  const hasAnchor = x.anchor !== undefined
  const hasBase = x.base_version_id !== undefined
  if (hasAnchor && !hasBase) return false
  if (x.parent_id !== undefined) return !hasAnchor && !hasBase
  if (x.kind === 'discussion') return !hasAnchor
  return hasAnchor && hasBase
}

function isCommentAnchorUpdate(x: unknown): x is CommentAnchorUpdate {
  return (
    isObj(x) &&
    isNonEmptyStr(x.comment_id) &&
    isCommentAnchor(x.anchor) &&
    (x.state === 'exact' || x.state === 'lost')
  )
}

function isMentionCandidate(x: unknown): x is MentionCandidate {
  return (
    isObj(x) &&
    isNonEmptyStr(x.user_id) &&
    isStr(x.display_name) &&
    isOpt(x.avatar_url, isStr) &&
    isOpt(x.email, isStr) &&
    isOpt(x.can_view, isBool)
  )
}

const isCommentIdPayload = (x: unknown): boolean => isObj(x) && isNonEmptyStr(x.comment_id)
const isCommentResult = (x: unknown): boolean => isObj(x) && isDocumentComment(x.comment)

export function isInitRecovery(x: unknown): x is InitRecovery {
  return (
    isObj(x) &&
    typeof CryptoKey !== 'undefined' &&
    x.key instanceof CryptoKey &&
    isNonEmptyStr(x.scope)
  )
}

export function isReadyPayload(x: unknown): x is ReadyPayload {
  return (
    isObj(x) &&
    isFiniteNum(x.protocolVersion) &&
    isOpt(x.frameVersion, isStr) &&
    isCapabilities(x.capabilities) &&
    isOpt(x.instanceId, isStr) &&
    isOpt(x.module, isOfficeModule)
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
    isOpt(x.open, isOpenPayload) &&
    isOpt(x.module, isOfficeModule) &&
    isOpt(x.user, isInitUser) &&
    isOpt(x.recovery, isInitRecovery) &&
    isOpt(x.downloadMaxBytes, isPositiveSafeInt)
    // x.commentsLevel is a hint: any value passes, the frame drops an unknown one (FE-W8P-1)
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
  'request:comments.reveal': isCommentIdPayload,
  'request:doc.download': (x) => isObj(x),
  // host -> frame events
  'event:file.renamed': (x) => isObj(x) && isFileMeta(x.file),
  'event:token.update': isTokenPayload,
  'event:theme': (x) => isObj(x) && isTheme(x.theme),
  'event:language': (x) => isObj(x) && isNonEmptyStr(x.locale),
  'event:cancel': (x) => isObj(x) && isNonEmptyStr(x.id),
  'event:doc.remoteVersion': (x) =>
    isObj(x) &&
    isNonEmptyStr(x.document_id) &&
    isDecimalRevision(x.revision) &&
    isNonEmptyStr(x.version_id) &&
    isNonEmptyStr(x.saved_at) &&
    isOpt(x.author_name, isStr),
  'event:comments.changed': (x) => isObj(x) && isNonEmptyStr(x.document_id),
  'event:doc.blocked': (x) => isObj(x) && isNonEmptyStr(x.document_id) && isNonEmptyStr(x.reason),
  // frame -> host requests
  'request:token.refresh': (x) =>
    isObj(x) && (x.reason === 'expiring' || x.reason === 'unauthorized'),
  'request:api.open': (x) =>
    isObj(x) && isNonEmptyStr(x.fileId) && isOpt(x.versionId, isNonEmptyStr),
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
  'request:app.open': (x) => isObj(x) && isOpt(x.feature, isStr),
  'request:api.assets.resolve': (x) =>
    isObj(x) &&
    isOpt(x.fileId, isStr) &&
    Array.isArray(x.paths) &&
    x.paths.length >= 1 &&
    x.paths.length <= 50 &&
    x.paths.every(isNonEmptyStr),
  'request:api.download': (x) => isObj(x) && isBuffer(x.data),
  'request:comments.list': (x) =>
    isObj(x) && isOpt(x.kind, isCommentKind) && isOpt(x.since_token, isNonEmptyStr),
  'request:comments.create': (x) =>
    isObj(x) &&
    isCommentKind(x.kind) &&
    isNonEmptyStr(x.body) &&
    isOpt(x.parent_id, isNonEmptyStr) &&
    isOpt(x.anchor, isCommentAnchor) &&
    isOpt(x.base_version_id, isNonEmptyStr) &&
    isCommentCreateAnchorShape(x),
  'request:comments.update': (x) =>
    isObj(x) && isNonEmptyStr(x.comment_id) && isNonEmptyStr(x.body),
  'request:comments.delete': isCommentIdPayload,
  'request:comments.resolve': isCommentIdPayload,
  'request:comments.reopen': isCommentIdPayload,
  'request:comments.revisions': isCommentIdPayload,
  'request:comments.anchors': (x) =>
    isObj(x) &&
    isNonEmptyStr(x.version_id) &&
    Array.isArray(x.anchors) &&
    x.anchors.length >= 1 &&
    x.anchors.length <= COMMENTS_MAX_ANCHORS &&
    x.anchors.every(isCommentAnchorUpdate),
  'request:comments.shareView': (x) => isObj(x) && isNonEmptyStr(x.user_id),
  'request:mentions.search': (x) =>
    isObj(x) &&
    isStr(x.q) &&
    isOpt(x.limit, isPositiveSafeInt) &&
    (x.include === undefined || x.include === 'no_access'),
  // frame -> host events
  'event:ready': isReadyPayload,
  'event:dirty': (x) => isObj(x) && isBool(x.dirty),
  'event:title': (x) => isObj(x) && isStr(x.title),
  'event:modal': (x) => isObj(x) && isBool(x.open),
  'event:resize': (x) => isObj(x) && isFiniteNum(x.height) && x.height >= 0,
  'event:saved': (x) =>
    isObj(x) && isFileMeta(x.file) && isOpt(x.versionId, isStr) && isBool(x.initiatedByFrame),
  'event:error': (x) => isObj(x) && isProtocolErrorShape(x.error) && isBool(x.fatal),
  'event:aiRun': (x) =>
    isObj(x) && (x.state === 'running' || x.state === 'idle') && isOpt(x.run_id, isNonEmptyStr),
  'event:size_warning': (x) =>
    isObj(x) &&
    isNonNegSafeInt(x.bytes) &&
    isPositiveSafeInt(x.max_bytes) &&
    isWarnRatio(x.warn_ratio),
  'event:save_blocked': (x) =>
    isObj(x) && isNonNegSafeInt(x.bytes) && isPositiveSafeInt(x.max_bytes),
  'event:open_refused': isOpenRefusedPayload,
  'event:lag_detected': (x) =>
    isObj(x) &&
    (x.reason === 'interactions' || x.reason === 'longtask') &&
    isNonNegSafeInt(x.worst_ms) &&
    isPositiveSafeInt(x.count) &&
    (x.window_ms === 0 || x.window_ms === 120_000) &&
    isOpt(x.bytes, isNonNegSafeInt),
  // successful responses
  'response:init': isInitAck,
  'response:open': (x) => isObj(x) && x.opened === true && isOpt(x.title, isStr),
  'response:save': isSaveResult,
  'response:saveAs': isSaveResult,
  'response:print': (x) => isObj(x) && isBool(x.printed),
  'response:token.refresh': isTokenPayload,
  'response:api.open': (x) =>
    isObj(x) &&
    isOpenPayload(x) &&
    isOpt(x.versionChanged, isBool) &&
    // a "the version changed" answer always says which revision it carries
    (x.versionChanged !== true || x.file.revision !== undefined),
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
  'response:api.assets.resolve': (x) => isObj(x) && isAssetMap(x.assets),
  'response:app.open': (x) =>
    isObj(x) && isStr(x.outcome) && (APP_OPEN_OUTCOMES as readonly string[]).includes(x.outcome),
  'response:convert.altChunkHtml': (x) => isObj(x) && (x.data === null || isBuffer(x.data)),
  'response:api.download': (x) => isObj(x) && x.delivered === true,
  'response:comments.list': (x) =>
    isObj(x) &&
    isArrayOf(x.comments, isDocumentComment) &&
    isArrayOf(x.mentions, isCommentMention) &&
    isNonEmptyStr(x.list_token) &&
    isBool(x.unchanged),
  'response:comments.create': isCommentResult,
  'response:comments.update': isCommentResult,
  'response:comments.delete': (x) =>
    isObj(x) && (x.outcome === 'tombstoned' || x.outcome === 'removed'),
  'response:comments.resolve': isCommentResult,
  'response:comments.reopen': isCommentResult,
  'response:comments.revisions': (x) => isObj(x) && isArrayOf(x.revisions, isCommentRevision),
  'response:comments.anchors': (x) =>
    isObj(x) &&
    isArrayOf(x.updated, isNonEmptyStr) &&
    isArrayOf(
      x.skipped,
      (y) =>
        isObj(y) &&
        isNonEmptyStr(y.comment_id) &&
        (y.reason === 'older_version' || y.reason === 'not_applicable'),
    ) &&
    isNonEmptyStr(x.list_token),
  'response:comments.shareView': (x) => isObj(x) && x.ok === true,
  'response:mentions.search': (x) => isObj(x) && isArrayOf(x.candidates, isMentionCandidate),
  'response:comments.reveal': (x) => isObj(x) && isBool(x.revealed),
  'response:doc.download': (x) => isObj(x) && x.delivered === true,
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

// ---------------------------------------------------------------- open_refused (additive, SIZE-F1 §3.1a)

export type OpenRefusedReason = 'engine_out_of_memory' | 'too_large_to_open' | 'too_complex'

export const OPEN_REFUSED_REASONS: readonly OpenRefusedReason[] = [
  'engine_out_of_memory',
  'too_large_to_open',
  'too_complex',
]

export const OPEN_REFUSED_MEASURE_KINDS = [
  'worksheet_xml_bytes',
  'paragraphs',
  'characters',
  'zip_parts',
  'cells',
] as const

export type OpenRefusedMeasureKind = (typeof OPEN_REFUSED_MEASURE_KINDS)[number]

/** Module-specific measure that tripped, when known (worksheet XML bytes, paragraph count, zip part count). */
export interface OpenRefusedMeasure {
  kind: OpenRefusedMeasureKind
  value: number
  limit?: number
}

/** The frame cannot show the document; sent at most once per documentId per session. */
export interface OpenRefusedPayload {
  reason: OpenRefusedReason
  /** Stored size of the document in bytes, when known (file.size / bytes.byteLength). */
  bytes?: number
  measure?: OpenRefusedMeasure
}

const isOpenRefusedReason = isOneOf(OPEN_REFUSED_REASONS)
const isOpenRefusedMeasureKind = isOneOf(OPEN_REFUSED_MEASURE_KINDS)

export function isOpenRefusedMeasure(x: unknown): x is OpenRefusedMeasure {
  return (
    isObj(x) &&
    isOpenRefusedMeasureKind(x.kind) &&
    isFiniteNum(x.value) &&
    x.value >= 0 &&
    isOpt(x.limit, (y): y is number => isFiniteNum(y) && y > 0)
  )
}

export function isOpenRefusedPayload(x: unknown): x is OpenRefusedPayload {
  return (
    isObj(x) &&
    isOpenRefusedReason(x.reason) &&
    isOpt(x.bytes, (y): y is number => isFiniteNum(y) && y >= 0) &&
    isOpt(x.measure, isOpenRefusedMeasure)
  )
}
