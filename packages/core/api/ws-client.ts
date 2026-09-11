import type { WSMessage, WSEventType } from "./ws-types";
import { type Logger, noopLogger } from "../logger";

type EventHandler = (payload: unknown, actorId?: string, actorType?: string) => void;

// Cap how much of an unparseable frame we put into the log. A malformed or
// rogue server can stream arbitrarily large garbage, and the warn handler may
// be a console / IPC bridge whose buffers we don't want to blow.
const UNPARSEABLE_LOG_MAX_CHARS = 200;

// Reconnect backoff parameters. A flat delay causes a thundering herd when many
// clients reconnect after a server restart; exponential backoff with jitter
// spreads the reconnection attempts over time. The client retries indefinitely
// (capped at RECONNECT_MAX_DELAY_MS) because the web/desktop UI does not yet
// expose a visible disconnected state or manual retry action.
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

export type WSConnectionState = "connecting" | "connected" | "disconnected";

function summarizeUnparseable(data: unknown): string {
  const text = typeof data === "string" ? data : String(data);
  if (text.length <= UNPARSEABLE_LOG_MAX_CHARS) return text;
  return `${text.slice(0, UNPARSEABLE_LOG_MAX_CHARS)}… (truncated, ${text.length} chars total)`;
}

/** Identifies the WS client to the server. Sent as `client_platform`,
 *  `client_version`, and `client_os` query parameters on the upgrade URL —
 *  browsers cannot set custom headers on WebSocket handshakes, so query
 *  params are the only portable channel. */
export interface WSClientIdentity {
  platform?: string;
  version?: string;
  os?: string;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private token: string | null = null;
  private workspaceSlug: string | null = null;
  private cookieAuth = false;
  /** Signed uw_guest value when HttpOnly cookies are unavailable on the upgrade. */
  private guestSession: string | null = null;
  private identity: WSClientIdentity | undefined;
  private handlers = new Map<WSEventType, Set<EventHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private hasConnectedBefore = false;
  /** Set after auth_ack; cleared when the socket closes. Used by lobby join fallback. */
  private authenticated = false;
  // One-shot per connection. A non-conforming frame can repeat hundreds of
  // times per session, so we log the first drop and suppress the rest. Reset
  // on each connect() so a fresh connection logs once again.
  private badFrameLogged = false;
  private onReconnectCallbacks = new Set<() => void>();
  private connectionState: WSConnectionState = "disconnected";
  private connectionStateListeners = new Set<(state: WSConnectionState) => void>();
  private anyHandlers = new Set<(msg: WSMessage) => void>();
  /** Explicit scope subscriptions replayed after reconnect (workspace/user are server-side). */
  private scopeSubscriptions = new Map<string, Set<string>>();
  private logger: Logger;

  constructor(
    url: string,
    options?: {
      logger?: Logger;
      cookieAuth?: boolean;
      guestSession?: string | null;
      identity?: WSClientIdentity;
    },
  ) {
    this.baseUrl = url;
    this.logger = options?.logger ?? noopLogger;
    this.cookieAuth = options?.cookieAuth ?? false;
    this.guestSession = options?.guestSession?.trim() ? options.guestSession.trim() : null;
    this.identity = options?.identity;
  }

  setAuth(token: string | null, workspaceSlug: string) {
    this.token = token;
    this.workspaceSlug = workspaceSlug;
  }

  /** True when the current socket received auth_ack and is still open. */
  isAuthenticated(): boolean {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    this.badFrameLogged = false;
    this.authenticated = false;
    this.setConnectionState("connecting");
    const url = new URL(this.baseUrl);
    // Token is never sent as a URL query parameter — it would be logged by
    // proxies, CDNs, and browser history.  In cookie mode the HttpOnly cookie
    // is sent automatically with the upgrade request.  In token mode the token
    // is delivered as the first WebSocket message after the connection opens.
    if (this.workspaceSlug)
      url.searchParams.set("workspace_slug", this.workspaceSlug);
    if (this.identity?.platform)
      url.searchParams.set("client_platform", this.identity.platform);
    if (this.identity?.version)
      url.searchParams.set("client_version", this.identity.version);
    if (this.identity?.os)
      url.searchParams.set("client_os", this.identity.os);

    this.ws = new WebSocket(url.toString());

    this.ws.onopen = () => {
      if (this.guestSession) {
        this.ws!.send(
          JSON.stringify({
            type: "auth",
            payload: { guest_session: this.guestSession },
          }),
        );
        return;
      }
      if (!this.cookieAuth && this.token) {
        this.ws!.send(
          JSON.stringify({ type: "auth", payload: { token: this.token } }),
        );
      }
    };

    this.ws.onmessage = (event) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(event.data as string) as WSMessage;
      } catch {
        this.logger.warn(
          "ws: received unparseable message",
          summarizeUnparseable(event.data),
        );
        return;
      }
      // Trust boundary: a frame must be an object carrying a string `type`.
      // The server protocol guarantees this for every frame, but a
      // non-conforming frame — an out-of-protocol frame injected by a proxy /
      // browser extension, or a bare JSON primitive — must degrade to a no-op
      // here. Without this guard every downstream consumer (the onAny
      // dispatcher and every ws.on subscriber) runs against a bad shape;
      // `msg.type.split(...)` in the realtime sync threw an uncaught TypeError
      // out of onmessage and surfaced as a flood of global `$exception` events
      // (MUL-3418). Validate once at the boundary, trust the shape downstream.
      if (!msg || typeof (msg as { type?: unknown }).type !== "string") {
        if (!this.badFrameLogged) {
          this.badFrameLogged = true;
          this.logger.warn(
            "ws: dropping frame without a string type",
            summarizeUnparseable(event.data),
          );
        }
        return;
      }
      if ((msg as any).type === "auth_ack") {
        this.onAuthenticated();
        return;
      }
      this.logger.debug("received", msg.type);
      const eventHandlers = this.handlers.get(msg.type);
      if (eventHandlers) {
        for (const handler of eventHandlers) {
          handler(msg.payload, msg.actor_id, msg.actor_type);
        }
      }
      for (const handler of this.anyHandlers) {
        handler(msg);
      }
    };

    this.ws.onclose = () => {
      this.authenticated = false;
      this.setConnectionState("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // Suppress — onclose handles reconnect; errors during StrictMode
      // double-fire are expected in dev and harmless.
    };
  }

  /**
   * Schedule a reconnection attempt with exponential backoff and jitter.
   * Retries indefinitely with a capped delay because the web/desktop UI
   * does not yet expose a visible disconnected state or manual retry action.
   */
  private scheduleReconnect() {
    const base = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS,
    );
    // ±20 % jitter so clients that disconnected at the same time don't
    // reconnect in lockstep.
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.round(
      Math.min(base + jitter, RECONNECT_MAX_DELAY_MS),
    );

    this.reconnectAttempt++;
    this.logger.warn(
      `ws: disconnected, reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`,
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private onAuthenticated() {
    this.authenticated = true;
    this.setConnectionState("connected");
    this.logger.info("connected");
    const recoveredConnection = this.hasConnectedBefore || this.reconnectAttempt > 0;
    this.reconnectAttempt = 0;
    if (recoveredConnection) {
      for (const cb of this.onReconnectCallbacks) {
        try {
          cb();
        } catch {
          // ignore reconnect callback errors
        }
      }
    }
    this.hasConnectedBefore = true;
    for (const [scope, ids] of this.scopeSubscriptions) {
      if (scope === "workspace" || scope === "user") continue;
      for (const id of ids) {
        this.sendSubscribe(scope, id);
      }
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Remove handlers before close to prevent onclose from scheduling a reconnect
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState("disconnected");
    this.hasConnectedBefore = false;
    this.reconnectAttempt = 0;
    this.handlers.clear();
    this.anyHandlers.clear();
    this.onReconnectCallbacks.clear();
    this.scopeSubscriptions.clear();
  }

  on(event: WSEventType, handler: EventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  onAny(handler: (msg: WSMessage) => void) {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  onReconnect(callback: () => void) {
    this.onReconnectCallbacks.add(callback);
    return () => {
      this.onReconnectCallbacks.delete(callback);
    };
  }

  getConnectionState(): WSConnectionState {
    return this.connectionState;
  }

  /** True after the first successful auth_ack; used to distinguish first connect from reconnect. */
  hasEverConnected(): boolean {
    return this.hasConnectedBefore;
  }

  onConnectionStateChange(callback: (state: WSConnectionState) => void) {
    this.connectionStateListeners.add(callback);
    callback(this.connectionState);
    return () => {
      this.connectionStateListeners.delete(callback);
    };
  }

  /** Force an immediate reconnect attempt (e.g. user tapped "Try again"). */
  reconnectNow() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  private setConnectionState(state: WSConnectionState) {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const listener of this.connectionStateListeners) {
      try {
        listener(state);
      } catch {
        // ignore listener errors
      }
    }
  }

  send(message: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /** Subscribe to a scoped realtime room (e.g. chat:{roomId}). */
  subscribe(scope: string, id: string) {
    if (!scope || !id) return;
    if (!this.scopeSubscriptions.has(scope)) {
      this.scopeSubscriptions.set(scope, new Set());
    }
    this.scopeSubscriptions.get(scope)!.add(id);
    this.sendSubscribe(scope, id);
  }

  /** Drop a scoped subscription established via subscribe(). */
  unsubscribe(scope: string, id: string) {
    if (!scope || !id) return;
    this.scopeSubscriptions.get(scope)?.delete(id);
    this.send({ type: "unsubscribe", payload: { scope, id } });
  }

  private sendSubscribe(scope: string, id: string) {
    this.send({ type: "subscribe", payload: { scope, id } });
  }
}
