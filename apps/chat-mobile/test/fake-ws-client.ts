// A stand-in for data/realtime/ws-client.ts › WSClient in the component and route layers, where there is no
// server: it records what the provider and the Layer 3 hooks ask of the socket and lets a test play the server
// (a state change, a frame, a reconnect, a session the server ended). Swapped in with
//   jest.mock("@/data/realtime/ws-client", () => ({ WSClient: jest.requireActual("@/test/fake-ws-client").FakeWSClient }));
import type { WSClientOptions } from "@/data/realtime/ws-types";
import type { ConnectionState } from "@/data/realtime/ws-types";

type Handler = (...args: unknown[]) => void;

export class FakeWSClient {
  /** Every client made since the last reset(), oldest first. */
  static instances: FakeWSClient[] = [];

  static reset(): void {
    FakeWSClient.instances = [];
  }

  static latest(): FakeWSClient {
    const client = FakeWSClient.instances.at(-1);
    if (!client) throw new Error("no WSClient was made");
    return client;
  }

  readonly opts: WSClientOptions;
  readonly calls: string[] = [];
  authenticated = true;
  connection: ConnectionState = "connecting";
  readonly subscriptions: string[] = [];
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();
  private readonly anyHandlers = new Set<Handler>();
  private readonly reconnectHandlers = new Set<() => void>();
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(opts: WSClientOptions) {
    this.opts = opts;
    FakeWSClient.instances.push(this);
  }

  connect(): void {
    this.calls.push("connect");
  }
  disconnect(): void {
    this.calls.push("disconnect");
  }
  pause(): void {
    this.calls.push("pause");
  }
  resume(): void {
    this.calls.push("resume");
  }
  forceReconnect(): void {
    this.calls.push("forceReconnect");
  }
  probe(): void {
    this.calls.push("probe");
  }
  isAuthenticated(): boolean {
    return this.authenticated;
  }
  /** Default null → HTTP fallback in use-chat-realtime tests. */
  sendPresenceBeat(_visible: boolean): Promise<string[] | null> {
    return Promise.resolve(null);
  }
  getConnectionState(): ConnectionState {
    return this.connection;
  }
  send(message: unknown): void {
    this.calls.push(`send:${JSON.stringify(message)}`);
  }
  subscribe(scope: string, id: string): void {
    this.subscriptions.push(`${scope}:${id}`);
  }
  unsubscribe(scope: string, id: string): void {
    const at = this.subscriptions.indexOf(`${scope}:${id}`);
    if (at >= 0) this.subscriptions.splice(at, 1);
  }

  onConnectionStateChange(cb: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }
  on(event: string, handler: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }
  onAny(handler: Handler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }
  onReconnect(cb: () => void): () => void {
    this.reconnectHandlers.add(cb);
    return () => this.reconnectHandlers.delete(cb);
  }

  // ── The server's side ──────────────────────────────────────────
  /** The socket's state moves (the "Connecting…" banner reads it). */
  emitState(state: ConnectionState): void {
    this.connection = state;
    for (const cb of this.stateListeners) cb(state);
  }
  /** A frame, to every onAny handler and the ones registered for its type. */
  emitFrame(message: { type: string; payload?: unknown; actor_id?: string; actor_type?: string }): void {
    for (const handler of this.anyHandlers) handler(message);
    for (const handler of this.handlers.get(message.type) ?? []) handler(message.payload, message.actor_id, message.actor_type);
  }
  /** The socket came back after a drop. */
  emitReconnect(): void {
    for (const cb of this.reconnectHandlers) cb();
  }
  /** The server ended the session (close 4001, a pre-auth refusal). */
  endSession(error?: string): void {
    this.opts.onSessionEnded?.(error);
  }
  /** How many handlers are still registered: zero once every subscriber cleaned up. */
  listenerCount(): number {
    let count = this.stateListeners.size + this.anyHandlers.size + this.reconnectHandlers.size;
    for (const set of this.handlers.values()) count += set.size;
    return count;
  }
}
