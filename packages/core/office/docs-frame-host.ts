/**
 * Docs frame postMessage endpoint, host side (GO-B2+B3, UNI-1013).
 *
 * Local stand-in for the fork's web/docs/protocol/host.ts, which has not
 * landed yet: same surface (handle / on / request / emit / dispose) over the
 * vendored envelope in ./docs-frame-protocol. Replace this file with the
 * vendored host.ts (and its fork SHA) once W2 commits it.
 *
 * A message is read only when its `source` is the frame's own window AND its
 * `origin` is one of the exact allowed origins; anything else is dropped.
 * Requests are correlated by id, time out, and can be cancelled.
 */
import {
  DocsProtocolError,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  parseEnvelope,
  toProtocolError,
  type Envelope,
  type MessageKind,
} from "./docs-frame-protocol";

export interface DocsFramePostTarget {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}
export interface DocsFrameMessageSource {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export interface DocsFrameHostOptions {
  /** The host page's window. */
  self: DocsFrameMessageSource;
  /** The iframe's window; null while it is not attached. */
  peer: () => DocsFramePostTarget | null;
  /** Exact origins; the first is the targetOrigin of every post. */
  allowedOrigins: readonly string[];
  timeoutMs?: number;
  /** A message from the frame window that was dropped (malformed, wrong version). */
  onReject?: (reason: string, detail: string) => void;
}

type Handler = (payload: unknown, context: { signal: AbortSignal }) => unknown;
type Listener = (payload: unknown) => void;

export interface DocsFrameHost {
  handle(type: string, handler: Handler): () => void;
  on(type: string, listener: Listener): () => void;
  emit(type: string, payload: unknown): boolean;
  request<T = unknown>(type: string, payload: unknown, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T>;
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createDocsFrameHost(options: DocsFrameHostOptions): DocsFrameHost {
  const allowed = new Set(options.allowedOrigins);
  if (allowed.size === 0 || allowed.has("*") || allowed.has("null")) throw new Error("docs frame host needs exact origins");
  const target = options.allowedOrigins[0]!;
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Set<Listener>>();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: DocsProtocolError) => void; cleanup: () => void }>();
  const inbound = new Map<string, AbortController>();
  let seq = 0;
  let disposed = false;

  const post = (kind: MessageKind, type: string, id: string, rest: Pick<Envelope, "payload" | "error">): boolean => {
    const peer = options.peer();
    if (disposed || !peer) return false;
    const message: Envelope = { ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind, type, ...rest };
    peer.postMessage(message, target);
    return true;
  };
  const fail = (code: DocsProtocolError["code"], message: string) => new DocsProtocolError({ code, message });

  const answer = async (message: Envelope) => {
    const handler = handlers.get(message.type);
    if (!handler) {
      post("response", message.type, message.id, { error: fail("unknown_type", `no handler for ${message.type}`).toShape() });
      return;
    }
    const controller = new AbortController();
    inbound.set(message.id, controller);
    try {
      const payload = await handler(message.payload, { signal: controller.signal });
      if (!controller.signal.aborted) post("response", message.type, message.id, { payload });
    } catch (error) {
      if (!controller.signal.aborted) post("response", message.type, message.id, { error: toProtocolError(error).toShape() });
    } finally {
      inbound.delete(message.id);
    }
  };

  const receive = (event: MessageEvent) => {
    if (disposed) return;
    const peer = options.peer();
    if (!peer || event.source !== peer || !allowed.has(event.origin)) return;
    const parsed = parseEnvelope(event.data);
    if (!parsed.ok) {
      if (parsed.reason === "foreign") return;
      if (parsed.reason === "version_mismatch") {
        const { message } = parsed;
        if (message.kind === "request") {
          post("response", message.type, message.id, { error: fail("version_mismatch", `host speaks protocol ${PROTOCOL_VERSION}, frame sent ${message.v}`).toShape() });
        }
        options.onReject?.("version_mismatch", `v${message.v}`);
        return;
      }
      const { partial } = parsed;
      if (partial?.kind === "request" && partial.id && partial.type) {
        post("response", partial.type, partial.id, { error: fail("malformed", parsed.detail).toShape() });
      }
      options.onReject?.("malformed", parsed.detail);
      return;
    }
    const { message } = parsed;
    if (message.kind === "request") {
      void answer(message);
    } else if (message.kind === "event") {
      if (message.type === "cancel") {
        const id = (message.payload as { id?: unknown }).id;
        if (typeof id === "string") inbound.get(id)?.abort();
        return;
      }
      for (const listener of listeners.get(message.type) ?? []) listener(message.payload);
    } else {
      const entry = pending.get(message.id);
      if (!entry) return;
      entry.cleanup();
      if (message.error) entry.reject(new DocsProtocolError(message.error));
      else entry.resolve(message.payload);
    }
  };
  options.self.addEventListener("message", receive);

  return {
    handle(type, handler) {
      handlers.set(type, handler);
      return () => { if (handlers.get(type) === handler) handlers.delete(type); };
    },
    on(type, listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
      return () => { set.delete(listener); };
    },
    emit(type, payload) {
      return post("event", type, `h${(seq += 1)}`, { payload });
    },
    request<T>(type: string, payload: unknown, requestOptions: { timeoutMs?: number; signal?: AbortSignal } = {}) {
      return new Promise<T>((resolve, reject) => {
        const id = `h${(seq += 1)}`;
        const settle = (error: DocsProtocolError) => { cleanup(); reject(error); };
        const onAbort = () => {
          post("event", "cancel", `h${(seq += 1)}`, { payload: { id } });
          settle(fail("cancelled", `${type} cancelled`));
        };
        const timer = setTimeout(() => settle(fail("timeout", `${type} timed out`)), requestOptions.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        function cleanup() {
          clearTimeout(timer);
          requestOptions.signal?.removeEventListener("abort", onAbort);
          pending.delete(id);
        }
        if (requestOptions.signal?.aborted) { settle(fail("cancelled", `${type} cancelled`)); return; }
        requestOptions.signal?.addEventListener("abort", onAbort);
        pending.set(id, { resolve: (value) => { resolve(value as T); }, reject, cleanup });
        if (!post("request", type, id, { payload })) settle(fail("not_ready", "docs frame is not attached"));
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.self.removeEventListener("message", receive);
      for (const controller of inbound.values()) controller.abort();
      for (const entry of [...pending.values()]) {
        entry.cleanup();
        entry.reject(fail("cancelled", "docs frame host disposed"));
      }
    },
  };
}
