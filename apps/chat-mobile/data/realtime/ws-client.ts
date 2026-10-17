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
 *
 * Server compatibility: same protocol as web/desktop. Sends
 *   {type:"auth", payload:{token}} as first frame; expects {type:"auth_ack"}
 *   before any business events; subscribe/unsubscribe frames carry
 *   {scope, id}, and explicit scopes are replayed after every auth_ack.
 *   workspace_slug + client_* are query params on the upgrade URL (RN's
 *   WebSocket cannot set headers).
 */
import { DEFAULT_CHAT_SCOPE_LIMIT } from "@uniwork/core/chat/lazy-chat-scopes";
import type { WSEventType, WSMessage } from "./ws-types";

type EventHandler = (payload: unknown, actorId?: string, actorType?: string) => void;
type AnyHandler = (msg: WSMessage) => void;

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
};

export interface WSClientOptions {
  /** wss://host/api/v1/ws — no query params; the client appends them. */
  url: string;
  /** Reads the CURRENT access token each time a socket opens. */
  getToken: () => Promise<string | null> | string | null;
  /** `org/ws` pair — the server resolves it and gates membership. */
  workspaceSlug: string;
  /** App version, surfaced to server logs. */
  clientVersion?: string;
  /** `Platform.OS` — passed in so this module never imports react-native. */
  clientOs: string;
  /** Defaults to "mobile". */
  clientPlatform?: string;
  logger?: Logger;
  /** The server closed the socket with 4001: expired token or revoked session. */
  onSessionEnded?: () => void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;
const RECONNECT_MAX_EXPONENT = 6; // 1s → 64s ceiling, capped at 30s
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

  private readonly handlers = new Map<WSEventType, Set<EventHandler>>();
  private readonly anyHandlers = new Set<AnyHandler>();
  private readonly onReconnectCallbacks = new Set<() => void>();
  /** Explicit scopes replayed after each auth_ack (workspace/user are server-side). */
  private readonly scopeSubscriptions = new Map<string, Set<string>>();

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

  /** True when the current socket received auth_ack and is still open. */
  isAuthenticated(): boolean {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  // ── public subscription ─────────────────────────────────────────────

  on(event: WSEventType, handler: EventHandler) {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
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
    this.sendSubscribe(scope, id);
  }

  /** Drop a scoped subscription established via subscribe(). */
  unsubscribe(scope: string, id: string) {
    if (!scope || !id) return;
    this.scopeSubscriptions.get(scope)?.delete(id);
    this.send({ type: "unsubscribe", payload: { scope, id } });
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
    this.logger.info("[ws] dialing", url.toString());

    ws.onopen = () => {
      const token = this.opts.getToken();
      if (token instanceof Promise) {
        // Drop the frame if this socket was replaced while the token resolved.
        void token.then((t) => this.ws === ws && this.sendAuth(ws, t));
      } else {
        this.sendAuth(ws, token);
      }
    };

    ws.onmessage = (event) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(event.data as string) as WSMessage;
      } catch {
        this.logger.warn("[ws] non-JSON frame ignored");
        return;
      }

      // Validate the envelope before transport frames or business dispatch.
      // JSON primitives (including null) and non-string types are not events.
      const type = (msg as { type?: unknown } | null)?.type;
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
      this.logger.debug("[ws] event", type);
      const set = this.handlers.get(type as WSEventType);
      if (set) {
        for (const handler of set) handler(msg.payload, msg.actor_id, msg.actor_type);
      }
      for (const handler of this.anyHandlers) handler(msg);
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
  private onSessionEnded() {
    this.logger.warn("[ws] session ended by server");
    this.opts.onSessionEnded?.();
  }

  private onAuthenticated() {
    this.authenticated = true;
    this.reconnectAttempt = 0;
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
    const exp = Math.min(this.reconnectAttempt, RECONNECT_MAX_EXPONENT);
    const ceiling = Math.min(RECONNECT_BASE_MS * 2 ** exp, RECONNECT_CAP_MS);
    const delay = Math.floor(Math.random() * ceiling);
    this.logger.info(`[ws] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
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
