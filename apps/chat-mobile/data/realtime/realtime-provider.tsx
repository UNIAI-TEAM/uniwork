/**
 * Realtime provider — Layer 2 of the realtime stack.
 * Ported from usf apps/mobile/data/realtime/realtime-provider.tsx
 *
 * Owns the WSClient instance, decides when it should be connected, and
 * exposes it via context to Layer 3 hooks (use-<feature>-realtime).
 *
 * Mounted inside the workspace layout, which hands it the signed-in user,
 * the `org/ws` pair and the session's token readers (Task 4 wiring). A
 * workspace switch → unmount/remount → fresh client with the new slug.
 *
 * Lifecycle signals:
 *   AppState 'background'  → pause the socket once the app has been away
 *                            BACKGROUND_GRACE_MS (background-grace.ts: an app
 *                            switch costs no reconnect; a clean close before
 *                            iOS kills it avoids a kernel-level reset on
 *                            resume), unless `holdOpen` (a call rings,
 *                            connects or is on: its accept and hang-up frames
 *                            must arrive); the pause happens when
 *                            the call ends
 *   AppState 'active'      → back within the grace: probe the socket now;
 *                            after a pause, past the grace, or over a socket
 *                            that is not authenticated (iOS zombie): resume
 *   AppState 'inactive'    → ignore (transient: app switcher / Control
 *                            Center / incoming call — tearing down here
 *                            causes spurious reconnect storms)
 *   NetInfo offline → online edge → force reconnect (don't wait for TCP
 *                                    keepalive timeout to notice the dead
 *                                    socket after wifi↔cellular handoff)
 *   close 4001 / pre-auth refusals → socket-recovery.ts: refresh (retried
 *                on a backoff after a transient failure), redial later when
 *                the server sheds, else down until the next signal.
 *
 * The socket's connection state (connecting / online / waiting / offline) is
 * exposed by useConnectionState() for the "Connecting…" banner.
 *
 * Provider does NOT register business event handlers — those live in
 * per-feature hooks so the realtime layer scales without one giant file.
 */
import NetInfo from "@react-native-community/netinfo";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { buildInfo } from "../build-info";
import { argsLogger, createLogger } from "../logger";
import { createBackgroundGrace } from "./background-grace";
import { createSocketRecovery } from "./socket-recovery";
import { WSClient } from "./ws-client";
import type { ConnectionState } from "./ws-types";

const log = createLogger("realtime");

const RealtimeContext = createContext<WSClient | null>(null);
const ConnectionContext = createContext<ConnectionState | null>(null);

/** The workspace socket's state; null outside a workspace (no socket is wanted there). */
export function useConnectionState(): ConnectionState | null {
  return use(ConnectionContext);
}

/** Subscribe to the realtime WebSocket. Returns null while disconnected
 *  (cold start, between workspace switches, signed out). Consumers must
 *  guard with `if (!ws) return` in their effect. */
export function useWSClient(): WSClient | null {
  return use(RealtimeContext);
}

export interface RealtimeProviderProps {
  userId: string | null;
  /** `org/ws` pair, as the WebSocket handshake carries it. */
  workspaceSlug: string | null;
  /** Current access token, read at each dial. */
  getToken: () => Promise<string | null> | string | null;
  /** Called on close 4001; resolves the new access token, null when signed
   *  out, and rejects on a transient failure (see refresh-for-socket.ts). */
  refreshSession: () => Promise<string | null>;
  /** A call is ringing, connecting or on: the socket stays open in the background. */
  holdOpen?: boolean;
  children: ReactNode;
}

export function RealtimeProvider({ userId, workspaceSlug, getToken, refreshSession, holdOpen = false, children }: RealtimeProviderProps) {
  const [client, setClient] = useState<WSClient | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const holdRef = useRef(holdOpen);
  holdRef.current = holdOpen;

  // The call that held the socket open in the background ended: pause now, as the background asked.
  useEffect(() => {
    if (!holdOpen && client && AppState.currentState === "background") client.pause();
  }, [holdOpen, client]);

  // Track NetInfo's last known state so we only force-reconnect on the
  // offline → online EDGE, not on every change event (NetInfo fires for
  // wifi strength changes, type changes, etc).
  const lastConnectedRef = useRef<boolean | null>(null);
  // Latest readers without rebuilding the socket when a parent re-renders.
  const sessionRef = useRef({ getToken, refreshSession });
  sessionRef.current = { getToken, refreshSession };

  useEffect(() => {
    if (!userId || !workspaceSlug) {
      setClient(null);
      setConnection(null);
      return;
    }

    const ws = new WSClient({
      url: `${runtimeConfig().wsUrl}/api/v1/ws`,
      getToken: () => sessionRef.current.getToken(),
      workspaceSlug,
      clientOs: Platform.OS,
      // The same version the REST headers carry: the hub logs and gates by it.
      clientVersion: buildInfo().version,
      logger: argsLogger("ws"),
      onSessionEnded: (error) => recovery.sessionEnded(error),
    });
    const recovery = createSocketRecovery({
      refreshSession: () => sessionRef.current.refreshSession(),
      reconnect: () => ws.forceReconnect(),
      disconnect: () => ws.disconnect(),
      warn: (message, data) => log.warn(message, data),
    });
    const connectionSub = ws.onConnectionStateChange((state) => {
      setConnection(state);
      if (state === "online") recovery.reset();
    });
    ws.connect();
    setClient(ws);

    // ── AppState ────────────────────────────────────────────────
    // A short absence keeps the socket; a long one pauses it; the return probes or redials (background-grace.ts).
    const grace = createBackgroundGrace(ws, {
      holdOpen: () => holdRef.current,
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });
    const appStateSub = AppState.addEventListener("change", (status: AppStateStatus) => grace.onAppState(status));

    // ── NetInfo ─────────────────────────────────────────────────
    lastConnectedRef.current = null;
    const netInfoUnsub = NetInfo.addEventListener((state) => {
      const isConnected = state.isConnected === true;
      const previous = lastConnectedRef.current;
      lastConnectedRef.current = isConnected;
      // Edge: false → true. First event (previous === null) is skipped —
      // connect()/resume() above already handle the initial state.
      if (previous === false && isConnected) {
        log.info("netinfo: back online, forceReconnect");
        ws.forceReconnect();
      }
    });

    return () => {
      appStateSub.remove();
      grace.dispose();
      netInfoUnsub();
      recovery.reset();
      connectionSub();
      ws.disconnect();
      setClient(null);
      setConnection(null);
    };
  }, [userId, workspaceSlug]);

  return (
    <RealtimeContext.Provider value={client}>
      <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>
    </RealtimeContext.Provider>
  );
}
