// Vendored from the genoffice fork (UNIAI-TEAM/uniwork-office),
// web/docs/protocol/host.ts at 07605ced5e14733de4fa28d57c1bec967b605973
// (fork SIZE-F1 integration branch feature/UNI-1861-size-f1 at 07605ced5: document size limits, size_warning,
// save_blocked, doc.download, lag_detected, open_refused; additive over bf4ff7b07; re-vendor from fork main once SIZE-F1 lands there).
// Byte-identical except the relative import specifiers (./types -> ./docs-frame-protocol, ./endpoint -> ./docs-frame-endpoint).
// Do not edit here: change the fork, re-vendor, update this SHA.
/* eslint-disable @typescript-eslint/no-misused-promises -- vendored: the async `ready` listener catches its own errors */
/**
 * Host-side protocol endpoint (runs in the UniWork page that embeds the
 * genoffice Docs iframe). Dependency-free apart from ./types and ./endpoint;
 * dev-uniwork vendors these three files together.
 *
 * - Accepts messages only from the iframe's window and only from the exact
 *   allowed frame origins; posts only to the first allowed origin.
 * - Handshake: waits for the frame's `ready`, checks the protocol version,
 *   asks `getInit` for a fresh server-minted token + session data and sends
 *   `init`. A later `ready` (frame reload) re-runs the handshake; a `ready`
 *   with a new `instanceId` while a handshake is in flight (the frame reloaded
 *   mid-handshake) aborts it and starts over.
 * - Token refresh: answers the frame's `token.refresh` via `refreshToken`,
 *   or pushes one proactively with `pushToken`.
 * - `api.*` (and `comments.*` / `mentions.search`) requests from the frame are
 *   proxied by the `api` handlers the host supplies (token-authorised fetches
 *   stay in the page).
 */
import {
  DEFAULT_TIMEOUT_MS,
  Endpoint,
  armTimeout,
  err,
  type MessageSource,
  type PostTarget,
  type RejectInfo,
  type RequestOptions,
} from './docs-frame-endpoint'
import {
  COMMENTS_REVEAL_MIN_TIMEOUT_MS,
  COMMENTS_REVEAL_RETRY_MS,
  DocsProtocolError,
  FRAME_REQUEST_TYPES,
  checkFrameModule,
  PROTOCOL_VERSION,
  toProtocolError,
  type CommentsRevealResult,
  type DocBlockedPayload,
  type FileMeta,
  type FrameEvents,
  type FrameRequests,
  type HostRequests,
  type InitAck,
  type InitPayload,
  type OfficeModule,
  type ProtocolErrorShape,
  type ReadyPayload,
  type RemoteVersionPayload,
  type Theme,
  type TokenPayload,
} from './docs-frame-protocol'

export type ApiRequestType = Exclude<keyof FrameRequests, 'token.refresh'>

export type ApiHandlers = {
  [K in ApiRequestType]?: (
    payload: FrameRequests[K]['payload'],
    ctx: { signal: AbortSignal },
  ) => Promise<FrameRequests[K]['result']> | FrameRequests[K]['result']
}

export interface DocsFrameHostOptions {
  /** the iframe's window, e.g. () => iframeRef.current?.contentWindow ?? null */
  frame: () => PostTarget | null
  /** exact frame origins; same-origin deployment: [location.origin] */
  allowedOrigins: readonly string[]
  /** default: window */
  self?: MessageSource
  /**
   * the document's module (GO-B4/B5/B6). Set: a frame whose `ready.module` differs fails the
   * handshake with `malformed` before `getInit` runs (no token is minted for the wrong editor),
   * and `init.module` carries it. Unset: `getInit`'s `module` (if any) is checked the same way;
   * neither = 'docs' on both sides, the pre-module behaviour.
   */
  module?: OfficeModule
  /** session data + a freshly minted token for this frame */
  getInit: (ready: ReadyPayload) => Promise<Omit<InitPayload, 'protocolVersion'>>
  /** mint a new token (the frame asked: expiring soon / got a 401) */
  refreshToken: (reason: 'expiring' | 'unauthorized') => Promise<TokenPayload>
  /** proxies for the frame's api.* requests; missing ones answer `unsupported` */
  api?: ApiHandlers
  /** called after every successful handshake (first load and reloads) */
  onInitialized?: (ack: InitAck, ready: ReadyPayload) => void
  /** handshake failed (version mismatch, getInit threw, init rejected/timed out) */
  onHandshakeError?: (error: DocsProtocolError) => void
  timeoutMs?: number
  onReject?: (info: RejectInfo) => void
}

type FrameEventListener<K extends keyof FrameEvents> = (payload: FrameEvents[K]) => void

export interface DocsFrameHost {
  /** true once `init` was acknowledged (and until the next frame reload) */
  readonly isReady: boolean
  /** resolves with the next/last successful InitAck; waits up to `timeoutMs` */
  whenReady(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<InitAck>
  open(
    payload: HostRequests['open']['payload'],
    options?: RequestOptions,
  ): Promise<HostRequests['open']['result']>
  save(
    payload: HostRequests['save']['payload'],
    options?: RequestOptions,
  ): Promise<HostRequests['save']['result']>
  saveAs(
    payload: HostRequests['saveAs']['payload'],
    options?: RequestOptions,
  ): Promise<HostRequests['saveAs']['result']>
  print(
    payload?: HostRequests['print']['payload'],
    options?: RequestOptions,
  ): Promise<HostRequests['print']['result']>
  /** before closing/navigating: does the frame hold unsaved work? */
  closeCheck(options?: RequestOptions): Promise<HostRequests['doc.closeCheck']['result']>
  /** the open document was renamed outside the editor */
  notifyRenamed(file: FileMeta): void
  /**
   * a newer version was saved elsewhere (additive, X-02). A frame before X-02 has no listener and
   * drops it silently (no reply, no reject).
   */
  notifyRemoteVersion(payload: RemoteVersionPayload): void
  /**
   * the comments of `documentId` changed (additive, G8-08: realtime `document.comment_*` /
   * `comment_anchors_updated`). Sent only to a frame whose InitAck has `comments`; also wakes a
   * pending `revealComment` retry. The wake ignores `documentId` and releases every pending retry
   * (one host = one document, so there is nothing to tell apart).
   */
  notifyCommentsChanged(documentId: string): void
  /**
   * ask the frame to show a comment thread (additive, G8-08, contract-collab §10 ordering).
   * Rejects `unsupported` without sending when the InitAck has no `comments` (the caller falls back
   * to its own panel). The timeout is never below COMMENTS_REVEAL_MIN_TIMEOUT_MS. On `not_ready` /
   * `timeout` it retries once, after COMMENTS_REVEAL_RETRY_MS or on the next
   * `notifyCommentsChanged`, whichever comes first (`retry: false` disables that); a second
   * failure rejects and the caller shows nothing. `revealed: false` = the frame already shows
   * the "not found" state itself.
   */
  revealComment(
    commentId: string,
    options?: RequestOptions & { retry?: boolean },
  ): Promise<CommentsRevealResult>
  /**
   * the open document is blocked for this viewer (additive, G5-03w). A frame before it has no
   * listener and drops it silently; the host keeps refusing its saves either way.
   */
  notifyBlocked(payload: DocBlockedPayload): void
  /** live theme / language switches (no-ops before the handshake; getInit supplies the initial values) */
  setTheme(theme: Theme): void
  setLanguage(locale: string): void
  /** proactive token rotation */
  pushToken(token: TokenPayload): void
  on<
    K extends 'dirty' | 'title' | 'modal' | 'resize' | 'saved' | 'error' | 'aiRun' | 'open_refused',
  >(
    type: K,
    listener: FrameEventListener<K>,
  ): () => void
  dispose(): void
}

export function createDocsFrameHost(options: DocsFrameHostOptions): DocsFrameHost {
  const self = options.self ?? (globalThis as unknown as MessageSource)
  const ep = new Endpoint({
    self,
    peer: options.frame,
    allowedOrigins: options.allowedOrigins,
    timeoutMs: options.timeoutMs,
    idPrefix: 'h',
    onReject: options.onReject,
  })

  let ack: InitAck | null = null
  /** the handshake in flight: which frame instance it targets + how to abort its `init` */
  let handshake: { instanceId?: string; abort: AbortController } | null = null
  /** instance whose handshake completed (its late `ready` retries are ignored) */
  let ackedInstance: string | undefined
  let generation = 0
  let disposed = false
  const waiters = new Set<{
    resolve: (a: InitAck) => void
    reject: (e: DocsProtocolError) => void
  }>()
  /** pending reveal retries, woken early by `notifyCommentsChanged` */
  const commentsWakers = new Set<() => void>()

  const failHandshake = (e: DocsProtocolError): void => {
    options.onHandshakeError?.(e)
    for (const w of [...waiters]) w.reject(e)
  }

  ep.on('ready', async (raw) => {
    const ready = raw as ReadyPayload
    if (disposed) return
    const { instanceId } = ready
    if (handshake) {
      // the frame re-sends `ready` until it gets `init`; only a new instance (reload) restarts
      if (instanceId === undefined || instanceId === handshake.instanceId) return
      handshake.abort.abort()
      handshake = null
    } else if (ack && instanceId !== undefined && instanceId === ackedInstance) {
      return // a retry that crossed our `init`
    }
    const gen = ++generation
    ack = null
    ackedInstance = undefined
    if (ready.protocolVersion !== PROTOCOL_VERSION) {
      failHandshake(
        err(
          'version_mismatch',
          `frame protocol v${ready.protocolVersion}, host v${PROTOCOL_VERSION}`,
          {
            details: { remoteVersion: ready.protocolVersion, localVersion: PROTOCOL_VERSION },
          },
        ),
      )
      return
    }
    if (options.module !== undefined) {
      const mismatch = checkFrameModule(ready, options.module)
      if (mismatch) return failHandshake(mismatch)
    }
    const abort = new AbortController()
    handshake = { abort, ...(instanceId !== undefined ? { instanceId } : {}) }
    const current = (): boolean => !disposed && gen === generation
    try {
      const init = await options.getInit(ready)
      if (!current()) return
      const module = options.module ?? init.module
      if (module !== undefined) {
        const mismatch = checkFrameModule(ready, module)
        if (mismatch) throw mismatch
      }
      const result = (await ep.request(
        'init',
        { ...init, ...(module !== undefined ? { module } : {}), protocolVersion: PROTOCOL_VERSION },
        { signal: abort.signal },
      )) as InitAck
      if (!current()) return
      ack = result
      ackedInstance = instanceId
      options.onInitialized?.(result, ready)
      for (const w of [...waiters]) w.resolve(result)
    } catch (e) {
      if (current()) failHandshake(toProtocolError(e))
    } finally {
      if (gen === generation) handshake = null
    }
  })

  ep.on('$version_mismatch', (shape) =>
    failHandshake(new DocsProtocolError(shape as ProtocolErrorShape)),
  )

  ep.handle('token.refresh', async (raw) => {
    const { reason } = raw as FrameRequests['token.refresh']['payload']
    try {
      return await options.refreshToken(reason)
    } catch (e) {
      const pe = toProtocolError(e)
      throw new DocsProtocolError({
        ...pe.toShape(),
        code: pe.code === 'network' ? 'network' : 'unauthorized',
      })
    }
  })

  const apiTypes = FRAME_REQUEST_TYPES.filter((t): t is ApiRequestType => t !== 'token.refresh')
  for (const type of apiTypes) {
    ep.handle(type, async (payload, ctx) => {
      // the frame may act on `init` before its ack reached us: wait for it
      if (!ack && !handshake) throw err('not_ready', `${type} before init`)
      if (!ack) await whenReady({ signal: ctx.signal })
      const h = options.api?.[type] as
        ((p: unknown, c: { signal: AbortSignal }) => unknown) | undefined
      if (!h) throw err('unsupported', `${type} is not available in this host`)
      return h(payload, { signal: ctx.signal })
    })
  }

  function whenReady(o: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<InitAck> {
    if (ack) return Promise.resolve(ack)
    if (disposed) return Promise.reject(err('cancelled', 'host disposed'))
    const timeoutMs = o.timeoutMs ?? options.timeoutMs ?? 30_000
    return new Promise<InitAck>((resolve, reject) => {
      const w = {
        resolve: (a: InitAck) => {
          done()
          resolve(a)
        },
        reject: (e: DocsProtocolError) => {
          done()
          reject(e)
        },
      }
      const clearTimer = armTimeout(timeoutMs, () =>
        w.reject(err('timeout', `frame not ready after ${timeoutMs} ms`)),
      )
      const onAbort = (): void => w.reject(err('cancelled', 'whenReady aborted'))
      const done = (): void => {
        clearTimer()
        o.signal?.removeEventListener('abort', onAbort)
        waiters.delete(w)
      }
      if (o.signal?.aborted) return onAbort()
      o.signal?.addEventListener('abort', onAbort, { once: true })
      waiters.add(w)
    })
  }

  async function call<K extends keyof HostRequests>(
    type: K,
    payload: HostRequests[K]['payload'],
    opts: RequestOptions = {},
  ): Promise<HostRequests[K]['result']> {
    await whenReady({ timeoutMs: opts.timeoutMs, signal: opts.signal })
    return (await ep.request(type, payload, opts)) as HostRequests[K]['result']
  }

  async function revealComment(
    commentId: string,
    o: RequestOptions & { retry?: boolean } = {},
  ): Promise<CommentsRevealResult> {
    const { retry = true, ...req } = o
    const base = req.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    // the frame answers `not_ready` itself within its wait limit; never time out before it
    const timeoutMs =
      Number.isFinite(base) && base > 0 ? Math.max(base, COMMENTS_REVEAL_MIN_TIMEOUT_MS) : base
    const attempt = async (): Promise<CommentsRevealResult> => {
      const a = await whenReady({ timeoutMs, signal: req.signal })
      if (a.capabilities.comments !== true) {
        throw err('unsupported', 'the frame does not show server comments')
      }
      return (await ep.request(
        'comments.reveal',
        { comment_id: commentId },
        { ...req, timeoutMs },
      )) as CommentsRevealResult
    }
    try {
      return await attempt()
    } catch (e) {
      const pe = toProtocolError(e)
      if (!retry || (pe.code !== 'not_ready' && pe.code !== 'timeout')) throw pe
    }
    await new Promise<void>((resolve, reject) => {
      const wake = (): void => {
        clearTimer()
        commentsWakers.delete(wake)
        req.signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = (): void => {
        clearTimer()
        commentsWakers.delete(wake)
        reject(err('cancelled', 'revealComment aborted'))
      }
      const clearTimer = armTimeout(COMMENTS_REVEAL_RETRY_MS, wake)
      if (req.signal?.aborted) return onAbort()
      req.signal?.addEventListener('abort', onAbort, { once: true })
      commentsWakers.add(wake)
    })
    return attempt()
  }

  const emitIfReady = (type: string, payload: unknown): void => {
    if (!ack) return
    try {
      ep.emit(type, payload)
    } catch {
      // frame gone; the next handshake carries current values
    }
  }

  return {
    get isReady() {
      return ack !== null
    },
    whenReady,
    open: (p, o) => call('open', p, o),
    save: (p, o) => call('save', p, o),
    saveAs: (p, o) => call('saveAs', p, o),
    print: (p = {}, o) => call('print', p, o),
    closeCheck: (o) => call('doc.closeCheck', {}, o),
    notifyRenamed: (file) => emitIfReady('file.renamed', { file }),
    notifyRemoteVersion: (p) => emitIfReady('doc.remoteVersion', { ...p }),
    notifyCommentsChanged(documentId) {
      if (ack?.capabilities.comments === true) {
        emitIfReady('comments.changed', { document_id: documentId })
      }
      for (const wake of [...commentsWakers]) wake()
    },
    revealComment,
    notifyBlocked: (p) => emitIfReady('doc.blocked', { ...p }),
    setTheme: (theme) => emitIfReady('theme', { theme }),
    setLanguage: (locale) => emitIfReady('language', { locale }),
    pushToken: (t) =>
      emitIfReady('token.update', { token: t.token, tokenExpiresAt: t.tokenExpiresAt }),
    on: (type, listener) => ep.on(type, listener as (p: unknown) => void),
    dispose() {
      if (disposed) return
      disposed = true
      ack = null
      commentsWakers.clear()
      for (const w of [...waiters]) w.reject(err('cancelled', 'host disposed'))
      ep.dispose()
    },
  }
}
