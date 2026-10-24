/**
 * Mobile WebSocket transport. Ported from usf apps/mobile/data/realtime/ws-client.ts
 *
 * Layer 1 of the realtime stack — owns a single socket, knows nothing about
 * React, AppState, NetInfo, or business events. Just: dial, redial with
 * backoff, dispatch frames to handlers.
 *
 * Differs from packages/core/api/ws-client.ts:
 *   - Three-state lifecycle (idle / active / paused) so the provider can
 *     pause on background and resume on foreground without racing the
 *     auto-reconnect timer.
 *   - Detaches socket handlers BEFORE close() to avoid the spurious
 *     onclose-triggered reconnect that bites RN (close is async over the
 *     bridge — see facebook/react-native#9465).
 *   - Token-mode auth only (no cookies on native); the token is read at
 *     auth-frame time, so a refreshed session is picked up by the next dial.
 *   - Close 4001 (session ended) is handed to `onSessionEnded` and NOT
 *     redialled by the client: the token is dead, so the host refreshes it
 *     and calls forceReconnect(), or disconnect() when it cannot.
 *   - Every frame is decoded before dispatch (./frames.ts): a listed event
 *     with a malformed payload is dropped, so handlers get typed payloads.
 *
 * Server compatibility: same protocol as web/desktop. Sends
 *   {type:"auth", payload:{token}} as first frame; expects {type:"auth_ack"}
 *   before any business events; subscribe/unsubscribe frames carry
 *   {scope, id}, and explicit scopes are replayed after every auth_ack.
 *   workspace_slug + client_* are query params on the upgrade URL (RN's
 *   WebSocket cannot set headers).
 */
import { DEFAULT_CHAT_SCOPE_LIMIT } from "@uniwork/core/chat/lazy-chat-scopes";
import { decodeFrame, type FramePayload, type KnownFrameType, type RealtimeFrame } from "./frames";
import { asRecord, pathOf } from "@/lib/unknown-shape";
import { reconnectDelayMs, type ConnectionState, type Logger, type WSClientOptions, type WSMessage } from "./ws-types";

type EventHandler = (payload: unknown, actorId?: string, actorType?: string) => void;

type AnyHandler = (frame: RealtimeFrame) => void;

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
};

const CLOSE_SESSION_ENDED = 4001;

// React Native does not surface WebSocket control Ping/Pong frames to
// JavaScript. The server sends control pings, but an iOS/NAT half-open socket
// can still look OPEN here forever. Its `/ws` handler also answers text
// {type:"ping"} with {type:"pong"}, which gives the mobile transport an
// observable liveness check without changing the protocol.
const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Lifecycle state — drives whether onclose schedules a reconnect:
 *   idle    — never connected, or fully disconnected. No reconnect on close.
 *   active  — wants to be connected. onclose → schedule reconnect.
 *   paused  — caller asked us to be off (e.g. app backgrounded). onclose
 *             does nothing; resume() reopens.
 */
type State = "idle" | "active" | "paused";

export class WSClient {
  private ws: WebSocket | null = null;
  private state: State = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private awaitingPong = false;
  private hasConnectedBefore = false;
  private authenticated = false;

  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly anyHandlers = new Set<AnyHandler>();
  private readonly onReconnectCallbacks = new Set<() => void>();
  private readonly connectionListeners = new Set<(state: ConnectionState) => void>();
  private connection: ConnectionState = "offline";
  /** Explicit scopes replayed after each auth_ack (workspace/user are server-side). */
  private readonly scopeSubscriptions = new Map<string, Set<string>>();
  private presenceBeatWaiter:
    | { resolve: (ids: string[] | null) => void; timer: ReturnType<typeof setTimeout> }
    | null = null;

  private readonly opts: WSClientOptions;
  private readonly logger: Logger;

  constructor(opts: WSClientOptions) {
    this.opts = opts;
    this.logger = opts.logger ?? noopLogger;
  }

  // ── public lifecycle ────────────────────────────────────────────────

  /** Idle → active. Initial connect. */
  connect() {
    if (this.state === "active") return;
    this.state = "active";
    this.openSocket();
  }

  /** Anything → idle. Full teardown — used on unmount / sign-out. */
  disconnect() {
    this.state = "idle";
    this.clearReconnect();
    this.teardownSocket();
    this.reconnectAttempt = 0;
    this.hasConnectedBefore = false;
    this.setConnection("offline");
  }

  /** Active → paused. Used by the provider when AppState=background.
   *  iOS will kill backgrounded sockets within seconds anyway; closing
   *  cleanly avoids the kernel-level reset surfacing as an error on
   *  resume. */
  pause() {
    if (this.state !== "active") return;
    this.state = "paused";
    this.clearReconnect();
    this.teardownSocket();
    this.setConnection("offline");
  }

  /** Return to the foreground with one fresh socket. An active socket may
   *  also need replacing after iOS silently drops the connection. */
  resume() {
    if (this.state === "idle") return;
    this.state = "active";
    this.forceReconnect();
  }

  /** Force a fresh socket without going through paused. Used when NetInfo
   *  reports we just came back online — the existing socket is likely a
   *  zombie (TCP keepalive timeout takes minutes; we want seconds) — and
   *  after a session refresh, so the new token gets its socket now. */
  forceReconnect() {
    if (this.state !== "active") return;
    this.clearReconnect();
    this.teardownSocket();
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  /** A heartbeat now, not at the next interval (background-grace.ts: back in the app after a short absence):
   *  a socket the OS cut meanwhile is replaced within the pong timeout. One check at a time. */
  probe() {
    if (!this.isAuthenticated() || this.awaitingPong) return;
    this.sendHeartbeat();
  }

  /** True when the current socket received auth_ack and is still open. */
  isAuthenticated(): boolean {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  getConnectionState(): ConnectionState {
    return this.connection;
  }

  /** Each change of getConnectionState(), for the "Connecting…" banner. */
  onConnectionStateChange(cb: (state: ConnectionState) => void) {
    this.connectionListeners.add(cb);
    return () => {
      this.connectionListeners.delete(cb);
    };
  }

  // ── public subscription ─────────────────────────────────────────────

  /** A handler for one decoded event (frames.ts): its payload has the decoder's type. */
  on<T extends KnownFrameType>(event: T, handler: (payload: FramePayload<T>, actorId?: string, actorType?: string) => void) {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);
    return () => {
      this.handlers.get(event)?.delete(handler as EventHandler);
    };
  }

  onAny(handler: AnyHandler) {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  /** Fires every time auth_ack arrives AFTER the first one — i.e. on each
   *  reconnect. Subscribers use this to invalidate query caches because
   *  any events between disconnect and reconnect were lost. */
  onReconnect(cb: () => void) {
    this.onReconnectCallbacks.add(cb);
    return () => {
      this.onReconnectCallbacks.delete(cb);
    };
  }

  send(message: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /** Chat presence heartbeat (parity: packages/core/api/ws-client.ts). */
  sendPresenceBeat(visible: boolean): Promise<string[] | null> {
    if (!this.isAuthenticated()) return Promise.resolve(null);
    if (this.presenceBeatWaiter) {
      clearTimeout(this.presenceBeatWaiter.timer);
      this.presenceBeatWaiter.resolve(null);
      this.presenceBeatWaiter = null;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.presenceBeatWaiter = null;
        resolve(null);
      }, 10_000);
      this.presenceBeatWaiter = { resolve, timer };
      this.send({ type: "presence.beat", payload: { state: "online", visible } });
    });
  }

  private resolvePresenceBeat(payload: unknown): void {
    const waiter = this.presenceBeatWaiter;
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.presenceBeatWaiter = null;
    const record = asRecord(payload);
    const ids = record?.online_user_ids;
    waiter.resolve(Array.isArray(ids) ? (ids as string[]) : null);
  }

  /** Subscribe to a scoped room (chat:{roomId}, meeting:{id}); replayed on
   *  every reconnect. Chat scopes are capped client-side below the server's
   *  50-per-socket limit, which also counts the identity scopes. */
  subscribe(scope: string, id: string) {
    if (!scope || !id) return;
    let ids = this.scopeSubscriptions.get(scope);
    if (!ids) {
      ids = new Set();
      this.scopeSubscriptions.set(scope, ids);
    }
    if (scope === "chat" && !ids.has(id) && ids.size >= DEFAULT_CHAT_SCOPE_LIMIT) {
      this.logger.warn("[ws] scope cap reached, subscribe refused", scope, id);
      return;
    }
    ids.add(id);
    // Before auth_ack the auth frame must stay first; onAuthenticated replays the set.
    if (this.authenticated) this.sendSubscribe(scope, id);
  }

  /** Drop a scoped subscription established via subscribe(). */
  unsubscribe(scope: string, id: string) {
    if (!scope || !id) return;
    // A scope not held was never sent; one held on an authenticated socket was.
    if (!this.scopeSubscriptions.get(scope)?.delete(id)) return;
    if (this.authenticated) this.send({ type: "unsubscribe", payload: { scope, id } });
  }

  // ── internal ────────────────────────────────────────────────────────

  private sendSubscribe(scope: string, id: string) {
    this.send({ type: "subscribe", payload: { scope, id } });
  }

  private openSocket() {
    const url = new URL(this.opts.url);
    url.searchParams.set("workspace_slug", this.opts.workspaceSlug);
    url.searchParams.set("client_platform", this.opts.clientPlatform ?? "mobile");
    url.searchParams.set("client_os", this.opts.clientOs);
    if (this.opts.clientVersion) {
      url.searchParams.set("client_version", this.opts.clientVersion);
    }

    const ws = new WebSocket(url.toString());
    this.ws = ws;
    this.authenticated = false;
    this.setConnection("connecting");
    this.logger.info("[ws] dialing", url.toString());

    ws.onopen = () => {
      const token = this.opts.getToken();
      if (token instanceof Promise) {
        // Drop the frame if this socket was replaced while the token resolved;
        // a reader that throws is "no token" (the server closes in 10s).
        void token.then(
          (t) => this.ws === ws && this.sendAuth(ws, t),
          () => this.ws === ws && this.sendAuth(ws, null),
        );
      } else {
        this.sendAuth(ws, token);
      }
    };

    ws.onmessage = (event) => {
      // Untrusted until each field is read through a guard: no frame shape is assumed.
      let msg: unknown;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        this.logger.warn("[ws] non-JSON frame ignored");
        return;
      }

      // A pre-auth {error} refusal is terminal: redialling would only repeat it.
      const error = pathOf(msg, "error");
      if (!this.authenticated && typeof error === "string") {
        this.teardownSocket();
        this.onSessionEnded(error);
        return;
      }
      // Validate the envelope before transport frames or business dispatch.
      // JSON primitives (including null) and non-string types are not events.
      const type = pathOf(msg, "type");
      if (typeof type !== "string" || !type) {
        // Server-side error frames have shape {error: "..."}; log and drop.
        this.logger.warn("[ws] frame without a string type", event.data);
        return;
      }
      if (type === "auth_ack") {
        this.onAuthenticated();
        return;
      }
      if (type === "pong") {
        this.onPong();
        return;
      }
      if (type === "presence.ack") {
        this.resolvePresenceBeat(pathOf(msg, "payload"));
        return;
      }
      this.logger.debug("[ws] event", type);
      const frame = decodeFrame({ ...asRecord(msg), type, payload: pathOf(msg, "payload") });
      if (!frame) return;
      const set = this.handlers.get(type);
      if (set) {
        for (const handler of set) handler(frame.payload, frame.actor_id, frame.actor_type);
      }
      for (const handler of this.anyHandlers) handler(frame);
    };

    ws.onerror = () => {
      // onerror is always paired with onclose — let onclose handle
      // reconnect. Logging here adds noise during normal teardown.
    };

    ws.onclose = (ev?: { code?: number }) => {
      // If we already swapped in a new socket, this onclose is from a
      // detached old one — ignore. (We try to detach handlers in
      // teardownSocket() but RN may dispatch onclose async over the bridge.)
      if (this.ws !== ws) return;

      this.ws = null;
      this.authenticated = false;
      this.clearHeartbeat();
      this.logger.warn("[ws] socket closed", ev?.code);
      if (ev?.code === CLOSE_SESSION_ENDED) {
        this.onSessionEnded();
        return;
      }
      // pause()/disconnect() detach handlers first, so a live onclose is active.
      this.scheduleReconnect();
    };
  }

  private sendAuth(ws: WebSocket, token: string | null) {
    if (!token) {
      this.logger.warn("[ws] no token, waiting for the server to close the socket");
      return;
    }
    this.logger.info("[ws] socket open, sending auth frame");
    ws.send(JSON.stringify({ type: "auth", payload: { token } }));
  }

  /** The token is dead: redialling with it would only earn another 4001, so
   *  the host refreshes and calls forceReconnect() (or disconnect()). */
  private onSessionEnded(error?: string) {
    this.logger.warn("[ws] session ended by server", error);
    // The host refreshes and redials, or disconnects (offline).
    this.setConnection("waiting");
    if (error === undefined) this.opts.onSessionEnded?.();
    else this.opts.onSessionEnded?.(error);
  }

  private onAuthenticated() {
    this.authenticated = true;
    this.reconnectAttempt = 0;
    this.setConnection("online");
    this.logger.info("[ws] authenticated");
    this.startHeartbeat();
    if (this.hasConnectedBefore) {
      for (const cb of this.onReconnectCallbacks) {
        try {
          cb();
        } catch (err) {
          this.logger.warn("[ws] onReconnect callback threw", err);
        }
      }
    }
    this.hasConnectedBefore = true;
    for (const [scope, ids] of this.scopeSubscriptions) {
      if (scope === "workspace" || scope === "user") continue;
      for (const id of ids) this.sendSubscribe(scope, id);
    }
  }

  private scheduleReconnect() {
    this.reconnectAttempt += 1;
    // Full jitter: random in [0, ceiling]. Spreads thundering herds when
    // many clients reconnect simultaneously (post-server-restart, post-
    // network-flap). AWS Builders' Library "Timeouts, retries, and backoff
    // with jitter" is the canonical reference.
    const delay = reconnectDelayMs(this.reconnectAttempt, Math.random());
    this.logger.info(`[ws] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
    this.setConnection("waiting");
  }

  private setConnection(next: ConnectionState) {
    if (this.connection === next) return;
    this.connection = next;
    for (const listener of this.connectionListeners) listener(next);
  }

  private clearReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  /**
   * An application-level heartbeat is deliberately scoped to authenticated,
   * foreground sockets. A missed pong is treated like any other disconnect:
   * close the stale socket and feed recovery through the existing exponential
   * backoff + full-jitter scheduler rather than immediately redialing.
   */
  private startHeartbeat() {
    this.clearHeartbeat();
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  private sendHeartbeat() {
    // Only reached from an authenticated socket's timers, which teardown clears.
    this.awaitingPong = true;
    try {
      // `ping`/`pong` are transport frames rather than business events.
      this.ws!.send(JSON.stringify({ type: "ping" }));
    } catch {
      this.reconnectAfterHeartbeatFailure();
      return;
    }

    this.pongTimer = setTimeout(() => {
      this.logger.warn("[ws] heartbeat timed out");
      this.reconnectAfterHeartbeatFailure();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private onPong() {
    if (!this.awaitingPong) return;
    this.awaitingPong = false;
    clearTimeout(this.pongTimer);
    this.logger.debug("[ws] heartbeat pong");
  }

  private reconnectAfterHeartbeatFailure() {
    this.teardownSocket();
    // Do not use forceReconnect(): health failures must retain the normal
    // exponential-backoff + full-jitter protection used by onclose.
    this.scheduleReconnect();
  }

  private clearHeartbeat() {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.pongTimer);
    this.awaitingPong = false;
  }

  private teardownSocket() {
    this.clearHeartbeat();
    this.authenticated = false;
    if (!this.ws) return;
    const ws = this.ws;
    // Detach BEFORE close — onclose firing after teardown would re-enter
    // the reconnect path against a discarded socket.
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      // close() can throw if the socket is already in CLOSING/CLOSED;
      // harmless.
    }
    this.ws = null;
  }
}
