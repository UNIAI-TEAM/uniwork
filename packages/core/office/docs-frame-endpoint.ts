// Vendored from the genoffice fork (UNIAI-TEAM/uniwork-office),
// web/docs/protocol/endpoint.ts at b6f773ff8a1b657dc8ee2af8d495e9003dc44549
// (lane branch feature/UNI-1013-docs-web-bridge). Byte-identical except the
// relative import specifiers (./types -> ./docs-frame-protocol, ./endpoint ->
// ./docs-frame-endpoint). Do not edit here: change the fork, re-vendor, update this SHA.

/**
 * Shared postMessage engine for host.ts and client.ts: origin/source checks,
 * request/response correlation with ids + timeouts + cancellation, error
 * mapping, version-mismatch replies.
 *
 * Dependency-free apart from ./types (vendored together with host.ts).
 */
import {
  DocsProtocolError,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  parseEnvelope,
  toProtocolError,
  type Envelope,
  type ProtocolErrorShape,
} from './docs-frame-protocol'

/** Minimal shape of the peer window (iframe.contentWindow / window.parent). */
export interface PostTarget {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void
}

/** Minimal shape of the window that receives messages. */
export interface MessageSource {
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (ev: MessageEvent) => void): void
}

export type RejectReason =
  'origin' | 'source' | 'malformed' | 'version_mismatch' | 'unknown_type' | 'unexpected_response'

export interface RejectInfo {
  reason: RejectReason
  origin: string
  detail?: string
  data: unknown
}

export interface EndpointOptions {
  /** window that receives `message` events (default: globalThis window) */
  self: MessageSource
  /** current peer window; messages whose `source` differs are dropped */
  peer: () => PostTarget | null
  /** exact origins accepted from the peer; the first one is used as targetOrigin */
  allowedOrigins: readonly string[]
  /** default request timeout, ms */
  timeoutMs?: number
  /** prefix for generated ids ('h' host, 'f' frame) */
  idPrefix: string
  /** observability hook for dropped messages */
  onReject?: (info: RejectInfo) => void
}

export interface RequestOptions {
  /** ms; 0 (or any non-positive / non-finite value) = no timeout, e.g. a request waiting on a user dialog */
  timeoutMs?: number
  signal?: AbortSignal
  /** ArrayBuffers to transfer instead of copy */
  transfer?: Transferable[]
}

export interface HandlerContext {
  /** aborted when the peer cancels the request or the endpoint is disposed */
  signal: AbortSignal
  origin: string
}

type Handler = (payload: unknown, ctx: HandlerContext) => unknown | Promise<unknown>
type Listener = (payload: unknown) => void

interface Pending {
  type: string
  resolve: (value: unknown) => void
  reject: (err: DocsProtocolError) => void
  cleanup: () => void
}

export const DEFAULT_TIMEOUT_MS = 30_000

/** `timeoutMs` 0 means "wait forever"; setTimeout(fn, 0) would time out at once */
export function armTimeout(timeoutMs: number, onTimeout: () => void): () => void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return () => {}
  const timer = setTimeout(onTimeout, timeoutMs)
  return () => clearTimeout(timer)
}

/** Throws on an empty list or a non-exact origin; returns the first one (the postMessage targetOrigin). */
export function validateOrigins(origins: readonly string[]): string {
  const first = origins[0]
  if (first === undefined) throw new Error('allowedOrigins must not be empty')
  for (const o of origins) {
    if (o === '*' || o === 'null' || !/^https?:\/\/[^/?#\s]+$/.test(o)) {
      throw new Error(
        `invalid allowed origin: ${JSON.stringify(o)} (exact scheme://host[:port] required)`,
      )
    }
  }
  return first
}

export class Endpoint {
  private readonly opts: EndpointOptions
  private readonly allowed: ReadonlySet<string>
  /** first allowed origin, captured at construction (later edits to the caller's array do not apply) */
  private readonly targetOrigin: string
  private readonly pending = new Map<string, Pending>()
  private readonly handlers = new Map<string, Handler>()
  private readonly listeners = new Map<string, Set<Listener>>()
  /** controllers for inbound requests, so a peer `cancel` can abort them */
  private readonly inbound = new Map<string, AbortController>()
  private seq = 0
  private disposed = false
  private readonly onMessage = (ev: MessageEvent): void => this.receive(ev)

  constructor(opts: EndpointOptions) {
    this.targetOrigin = validateOrigins(opts.allowedOrigins)
    this.opts = opts
    this.allowed = new Set(opts.allowedOrigins)
    opts.self.addEventListener('message', this.onMessage)
  }

  /** Register the handler for an inbound request type (one per type). */
  handle(type: string, handler: Handler): () => void {
    this.handlers.set(type, handler)
    return () => {
      if (this.handlers.get(type) === handler) this.handlers.delete(type)
    }
  }

  /** Subscribe to an inbound event type. */
  on(type: string, listener: Listener): () => void {
    let set = this.listeners.get(type)
    if (!set) this.listeners.set(type, (set = new Set()))
    set.add(listener)
    return () => set.delete(listener)
  }

  emit(type: string, payload: unknown, transfer?: Transferable[]): void {
    this.post(
      { ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: this.nextId(), kind: 'event', type, payload },
      transfer,
    )
  }

  request(type: string, payload: unknown, options: RequestOptions = {}): Promise<unknown> {
    if (this.disposed) return Promise.reject(err('cancelled', 'endpoint disposed'))
    const { signal, transfer } = options
    if (signal?.aborted) return Promise.reject(err('cancelled', `${type} aborted`))
    const id = this.nextId()
    const timeoutMs = options.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<unknown>((resolve, reject) => {
      const clearTimer = armTimeout(timeoutMs, () => {
        this.settle(id)?.reject(
          err('timeout', `${type} timed out after ${timeoutMs} ms`, { retryable: true }),
        )
      })
      const onAbort = (): void => {
        const p = this.settle(id)
        if (!p) return
        this.emit('cancel', { id })
        p.reject(err('cancelled', `${type} aborted`))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        type,
        resolve,
        reject,
        cleanup: () => {
          clearTimer()
          signal?.removeEventListener('abort', onAbort)
        },
      })
      try {
        this.post(
          { ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind: 'request', type, payload },
          transfer,
        )
      } catch (e) {
        this.settle(id)?.reject(toProtocolError(e))
      }
    })
  }

  /** Reject everything in flight, abort inbound handlers, stop listening. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.opts.self.removeEventListener('message', this.onMessage)
    for (const id of [...this.pending.keys()]) {
      this.settle(id)?.reject(err('cancelled', 'endpoint disposed'))
    }
    for (const c of this.inbound.values()) c.abort()
    this.inbound.clear()
    this.handlers.clear()
    this.listeners.clear()
  }

  get pendingCount(): number {
    return this.pending.size
  }

  // ------------------------------------------------------------ internals

  private nextId(): string {
    this.seq += 1
    return `${this.opts.idPrefix}${this.seq}-${Math.random().toString(36).slice(2, 10)}`
  }

  private settle(id: string): Pending | undefined {
    const p = this.pending.get(id)
    if (!p) return undefined
    this.pending.delete(id)
    p.cleanup()
    return p
  }

  private post(msg: Envelope, transfer?: Transferable[]): void {
    if (this.disposed) return
    const peer = this.opts.peer()
    if (!peer) throw err('not_ready', 'peer window not available')
    peer.postMessage(msg, this.targetOrigin, transfer)
  }

  private reply(req: Envelope, body: { payload?: unknown; error?: ProtocolErrorShape }): void {
    const msg: Envelope = {
      ns: PROTOCOL_NS,
      v: PROTOCOL_VERSION,
      id: req.id,
      kind: 'response',
      type: req.type,
    }
    if (body.error) msg.error = body.error
    else msg.payload = body.payload
    try {
      // no implicit transfer: the handler may still own the buffers it returned
      this.post(msg)
    } catch {
      // peer went away; nothing to answer
    }
  }

  private reject(reason: RejectReason, ev: MessageEvent, detail?: string): void {
    this.opts.onReject?.({ reason, origin: ev.origin, detail, data: ev.data })
  }

  private receive(ev: MessageEvent): void {
    if (this.disposed) return
    // 1. origin: exact match against the allow list
    if (!this.allowed.has(ev.origin)) {
      // other origins' traffic is common (extensions); only report our own tag
      if (isTagged(ev.data)) this.reject('origin', ev)
      return
    }
    // 2. source: must be the peer window (not a sibling frame / popup / self)
    const peer = this.opts.peer()
    if (!peer || ev.source !== (peer as unknown)) {
      if (isTagged(ev.data)) this.reject('source', ev)
      return
    }
    const parsed = parseEnvelope(ev.data)
    if (!parsed.ok) {
      if (parsed.reason === 'foreign') return
      if (parsed.reason === 'version_mismatch') {
        this.onVersionMismatch(parsed.message, ev)
        return
      }
      this.reject('malformed', ev, parsed.detail)
      const p = parsed.partial
      if (p?.id && p.kind === 'request') {
        this.reply(p as Envelope, { error: { code: 'malformed', message: parsed.detail } })
      } else if (p?.id && p.kind === 'response') {
        this.settle(p.id)?.reject(err('malformed', parsed.detail))
      }
      return
    }
    const msg = parsed.message
    if (msg.kind === 'response') this.onResponse(msg, ev)
    else if (msg.kind === 'request') void this.onRequest(msg, ev)
    else this.onEvent(msg)
  }

  private onVersionMismatch(msg: Envelope, ev: MessageEvent): void {
    const detail = `peer v${msg.v}, local v${PROTOCOL_VERSION}`
    this.reject('version_mismatch', ev, detail)
    const shape: ProtocolErrorShape = {
      code: 'version_mismatch',
      message: `protocol version mismatch (${detail})`,
      details: { remoteVersion: msg.v, localVersion: PROTOCOL_VERSION },
    }
    if (msg.kind === 'request') this.reply(msg, { error: shape })
    else if (msg.kind === 'response') this.settle(msg.id)?.reject(new DocsProtocolError(shape))
    // the handshake still needs to learn about it; let `ready`/`init` observers see it
    else this.dispatchEvent('$version_mismatch', shape)
  }

  private onResponse(msg: Envelope, ev: MessageEvent): void {
    const p = this.pending.get(msg.id)
    if (!p || p.type !== msg.type) {
      this.reject('unexpected_response', ev, `no pending ${msg.type} ${msg.id}`)
      return
    }
    this.settle(msg.id)
    if (msg.error) p.reject(new DocsProtocolError(msg.error))
    else p.resolve(msg.payload)
  }

  private async onRequest(msg: Envelope, ev: MessageEvent): Promise<void> {
    const handler = this.handlers.get(msg.type)
    if (!handler) {
      this.reject('unknown_type', ev, msg.type)
      this.reply(msg, { error: { code: 'unknown_type', message: `no handler for ${msg.type}` } })
      return
    }
    const controller = new AbortController()
    this.inbound.set(msg.id, controller)
    try {
      const result = await handler(msg.payload, { signal: controller.signal, origin: ev.origin })
      if (controller.signal.aborted) return // the requester already gave up
      this.reply(msg, { payload: result ?? {} })
    } catch (e) {
      if (controller.signal.aborted) return
      this.reply(msg, { error: toProtocolError(e).toShape() })
    } finally {
      this.inbound.delete(msg.id)
    }
  }

  private onEvent(msg: Envelope): void {
    if (msg.type === 'cancel') {
      const id = (msg.payload as { id: string }).id
      this.inbound.get(id)?.abort()
      this.inbound.delete(id)
      return
    }
    this.dispatchEvent(msg.type, msg.payload)
  }

  private dispatchEvent(type: string, payload: unknown): void {
    const set = this.listeners.get(type)
    if (!set) return
    for (const l of [...set]) {
      try {
        l(payload)
      } catch {
        // a throwing listener must not break the others
      }
    }
  }
}

export function err(
  code: ProtocolErrorShape['code'],
  message: string,
  extra: Omit<ProtocolErrorShape, 'code' | 'message'> = {},
): DocsProtocolError {
  return new DocsProtocolError({ code, message, ...extra })
}

function isTagged(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { ns?: unknown }).ns === PROTOCOL_NS
}
