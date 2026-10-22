// The socket client's contract (ws-client.ts): the transport envelope of a
// realtime frame — a local copy, @uniwork/core/api/ws-types is not on the
// mobile allowlist (ADR 0011); what a payload holds is frames.ts's —, the
// connection states the person is told, the options a host passes, and the
// redial backoff. Kept apart so the client holds only the socket's lifecycle.

export interface WSMessage<T = unknown> {
  /** A catalogue event, or a transport frame (subscribe_ack, subscribe_error, …). */
  type: string;
  payload: T;
  actor_id?: string;
  actor_type?: string;
}

/**
 * What the person is told about the socket:
 *   connecting — dialing, or open and waiting for auth_ack
 *   online     — authenticated
 *   waiting    — down, a redial or the host's session refresh is pending
 *   offline    — not trying: never connected, paused (background) or disconnected
 */
export type ConnectionState = "connecting" | "online" | "waiting" | "offline";

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

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
  /** The server ended this socket: close 4001 (no reason) or a pre-auth
   *  `{error}` refusal (its text: invalid token, not a member, too many
   *  connections). The client does not redial either; the host decides. */
  onSessionEnded?: (error?: string) => void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;
const RECONNECT_MAX_EXPONENT = 6; // 1s → 64s ceiling, capped at 30s

/**
 * The wait before redial `attempt` (1, 2, …): full jitter, a random point in
 * [0, ceiling) where the ceiling doubles from 1 s up to 30 s. It spreads the
 * thundering herd of every client redialling at once after a server restart
 * or a network flap (AWS Builders' Library, "Timeouts, retries, and backoff
 * with jitter"). `random` is Math.random()'s, in [0, 1).
 */
export function reconnectDelayMs(attempt: number, random: number): number {
  const exp = Math.min(attempt, RECONNECT_MAX_EXPONENT);
  const ceiling = Math.min(RECONNECT_BASE_MS * 2 ** exp, RECONNECT_CAP_MS);
  return Math.floor(random * ceiling);
}
