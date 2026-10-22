// UniChat's product events: how often the app
// is opened, messages go out or fail for good, pushes are opened, calls
// connect and call pushes ring, and how long the first screen, a send and a call connect take. A
// first-party sink, no SDK: the events wait in memory and go in batches to
// POST /api/v1/mobile/events, which only counts them by OS and store version
// (server metrics.MobileEvents) — no person, organization, room or text is in
// an event or kept anywhere, and the build's identity rides on the X-Client-*
// headers every request has. A person turns it off in Settings › Privacy
// (lib/app-lock.ts › usageStats): what is queued is dropped and nothing more
// is recorded. Nothing is retried: a batch that fails is a breadcrumb, not a
// backlog, and the queue keeps at most MAX_QUEUE events.
import { AppState } from "react-native";
import { api } from "./api";
import { callEngine } from "./calls/call-store";
import { observeChatSends } from "./chat-send";
import { bestEffort } from "./report";

export type ProductEvent =
  | { name: "app_open"; result: "cold" | "warm" }
  | { name: "first_screen"; result: "ok"; duration_ms: number }
  | { name: "message_send"; result: "sent"; duration_ms: number }
  | { name: "message_send"; result: "failed" }
  | { name: "push_open"; result: "chat" | "call" | "other" }
  | { name: "call_connect"; result: "connected"; duration_ms: number }
  | { name: "call_connect"; result: "failed" }
  // What a call push did on the phone (data/calls/call-push.ts › CallPushOutcome): ring delivery, measured in the field.
  // `native`: rung by the FCM service with no JavaScript (data/calls/native-ring.ts), counted when JavaScript next runs.
  | { name: "call_push"; result: "shown" | "native" | "fallback" | "in_app" | "ignored" | "cleared" | "lost" }
  // How long after the server rang a call the phone rang it: natively, or by the JavaScript task (`app`).
  | { name: "call_ring"; result: "native" | "app"; duration_ms: number }
  // How a launch went (data/release/launch-health.ts): an OTA update that failed to launch, and a run that crashed.
  | { name: "ota_launch"; result: "emergency" | "failed_update" }
  | { name: "app_crash"; result: "last_run" };

/** The most events kept between two flushes; older ones are dropped first. */
export const MAX_QUEUE = 60;
/** What one request carries (the server counts at most 20). */
export const BATCH_SIZE = 20;
/** How often a foreground app sends what it has. */
export const FLUSH_EVERY_MS = 60_000;

export interface AnalyticsDeps {
  send: (events: ProductEvent[]) => Promise<unknown>;
  /** The person's choice (Settings › Privacy); read at every event and flush. */
  enabled: () => boolean;
  /** Events go only with a session (the route needs one). */
  signedIn: () => boolean;
}

export interface Analytics {
  track: (event: ProductEvent) => void;
  flush: () => Promise<void>;
  /** Queued events, for tests and the debug screen. */
  pending: () => number;
}

export function createAnalytics(deps: AnalyticsDeps): Analytics {
  const queue: ProductEvent[] = [];
  let flushing: Promise<void> | null = null;

  const drain = async () => {
    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH_SIZE);
      await deps.send(batch).catch(bestEffort("analytics", "batch not sent", "breadcrumb"));
    }
  };

  return {
    track(event) {
      if (!deps.enabled()) return;
      queue.push(event);
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    },
    flush() {
      if (!deps.enabled()) {
        queue.length = 0;
        return Promise.resolve();
      }
      if (!deps.signedIn() || queue.length === 0) return Promise.resolve();
      flushing ??= drain().finally(() => {
        flushing = null;
      });
      return flushing;
    },
    pending: () => queue.length,
  };
}

let instance: Analytics | null = null;
const queued: ProductEvent[] = [];

/** Records one event; before the app wires the sink (a headless task, a test) it waits, bounded, for it. */
export function track(event: ProductEvent): void {
  if (instance) instance.track(event);
  else if (queued.push(event) > MAX_QUEUE) queued.shift();
}

/** What a tapped push was about: a call's carries its call_id (server push_expo.go › callData), a chat message's its room. */
export function pushOpenResult(data: unknown): "chat" | "call" | "other" {
  const field = (key: string): unknown => (data !== null && typeof data === "object" ? Reflect.get(data, key) : undefined);
  if (typeof field("call_id") === "string") return "call";
  return typeof field("room_id") === "string" ? "chat" : "other";
}

/**
 * Whether a call that ended before its media room connected failed to connect:
 * the engine gave up on it (connect_failed — the connecting clock ran out, the
 * token or the accept failed — or start_failed, the invite never went out), or
 * the media room let go of it before it ever connected (peer_ended from active).
 * A call the person closed themselves goes to idle and is not a failure.
 */
function failedToConnect(reason: string, from: string, connecting: boolean): boolean {
  if (reason === "start_failed") return true;
  return connecting && (reason === "connect_failed" || (reason === "peer_ended" && from === "active"));
}

/**
 * Wires the sink once (app/_layout.tsx): a cold open now, a warm one on each
 * return from the background, a flush every minute while open and on each
 * trip to the background, every send's outcome (data/chat-send.ts) and every
 * call whose media connects or that fails to. Returns the teardown.
 */
export function startAnalytics(deps: Omit<AnalyticsDeps, "send">, now: () => number = Date.now): () => void {
  const sink = createAnalytics({
    ...deps,
    send: (events) => api.request("/api/v1/mobile/events", { method: "POST", body: JSON.stringify({ events }) }),
  });
  instance = sink;
  for (const event of queued.splice(0)) sink.track(event);
  sink.track({ name: "app_open", result: "cold" });

  let away = false;
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "background") {
      away = true;
      void sink.flush();
    } else if (state === "active" && away) {
      away = false;
      sink.track({ name: "app_open", result: "warm" });
    }
  });
  const timer = setInterval(() => {
    if (AppState.currentState === "active") void sink.flush();
  }, FLUSH_EVERY_MS);
  const stopSends = observeChatSends((outcome, ms) =>
    sink.track(outcome === "sent" ? { name: "message_send", result: "sent", duration_ms: ms } : { name: "message_send", result: "failed" }),
  );

  // A call's connect runs from "connecting" (the peer answered, or Answer was tapped) to its media room
  // connecting (call-room.tsx › markConnected) — not to "active", which only means a token was minted.
  let connectingSince: number | null = null;
  const stopCalls = callEngine.store.subscribe(({ call }, previous) => {
    if (call.status === previous.call.status) return;
    if (call.status === "connecting") connectingSince = now();
    else if (call.status === "ended" && failedToConnect(call.reason, previous.call.status, connectingSince !== null)) {
      sink.track({ name: "call_connect", result: "failed" });
      connectingSince = null;
    } else if (call.status === "idle" || call.status === "ended") connectingSince = null;
  });
  const stopMedia = callEngine.onMediaConnected(() => {
    if (connectingSince === null) return;
    sink.track({ name: "call_connect", result: "connected", duration_ms: now() - connectingSince });
    connectingSince = null;
  });

  return () => {
    appState.remove();
    clearInterval(timer);
    stopSends();
    stopCalls();
    stopMedia();
    instance = null;
  };
}
