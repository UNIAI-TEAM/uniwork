// Vendored from the genoffice fork (UNIAI-TEAM/uniwork-office),
// web/docs/protocol/host.ts at ed5eafe7b6cc0812d797504bed56226ddc3fea11
// (lane branch feature/UNI-1013-docs-web-bridge). Byte-identical except the
// relative import specifiers (./types -> ./docs-frame-protocol, ./endpoint ->
// ./docs-frame-endpoint). Do not edit here: change the fork, re-vendor, update this SHA.
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
 *   `init`. A later `ready` (frame reload) re-runs the handshake.
 * - Token refresh: answers the frame's `token.refresh` via `refreshToken`,
 *   or pushes one proactively with `pushToken`.
 * - `api.*` requests from the frame are proxied by the `api` handlers the
 *   host supplies (token-authorised fetches stay in the page).
 */
import {
  Endpoint,
  err,
  type MessageSource,
  type PostTarget,
  type RejectInfo,
  type RequestOptions,
} from './docs-frame-endpoint'
import {
  DocsProtocolError,
  FRAME_REQUEST_TYPES,
  PROTOCOL_VERSION,
  toProtocolError,
  type FileMeta,
  type FrameEvents,
  type FrameRequests,
  type HostRequests,
  type InitAck,
  type InitPayload,
  type ProtocolErrorShape,
  type ReadyPayload,
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
  /** live theme / language switches (no-ops before the handshake; getInit supplies the initial values) */
  setTheme(theme: Theme): void
  setLanguage(locale: string): void
  /** proactive token rotation */
  pushToken(token: TokenPayload): void
  on<K extends 'dirty' | 'title' | 'resize' | 'saved' | 'error'>(
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
  let handshaking = false
  let disposed = false
  const waiters = new Set<{
    resolve: (a: InitAck) => void
    reject: (e: DocsProtocolError) => void
  }>()

  const failHandshake = (e: DocsProtocolError): void => {
    options.onHandshakeError?.(e)
    for (const w of [...waiters]) w.reject(e)
  }

  ep.on('ready', async (raw) => {
    const ready = raw as ReadyPayload
    if (handshaking || disposed) return // the frame re-sends `ready` until it gets `init`
    ack = null
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
    handshaking = true
    try {
      const init = await options.getInit(ready)
      if (disposed) return
      const result = (await ep.request('init', {
        ...init,
        protocolVersion: PROTOCOL_VERSION,
      })) as InitAck
      ack = result
      options.onInitialized?.(result, ready)
      for (const w of [...waiters]) w.resolve(result)
    } catch (e) {
      if (!disposed) failHandshake(toProtocolError(e))
    } finally {
      handshaking = false
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
      if (!ack && !handshaking) throw err('not_ready', `${type} before init`)
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
      const timer = setTimeout(
        () => w.reject(err('timeout', `frame not ready after ${timeoutMs} ms`)),
        timeoutMs,
      )
      const onAbort = (): void => w.reject(err('cancelled', 'whenReady aborted'))
      const done = (): void => {
        clearTimeout(timer)
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
    setTheme: (theme) => emitIfReady('theme', { theme }),
    setLanguage: (locale) => emitIfReady('language', { locale }),
    pushToken: (t) =>
      emitIfReady('token.update', { token: t.token, tokenExpiresAt: t.tokenExpiresAt }),
    on: (type, listener) => ep.on(type, listener as (p: unknown) => void),
    dispose() {
      if (disposed) return
      disposed = true
      ack = null
      for (const w of [...waiters]) w.reject(err('cancelled', 'host disposed'))
      ep.dispose()
    },
  }
}
