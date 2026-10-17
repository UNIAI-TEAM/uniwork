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
 *   AppState 'background'  → pause socket (iOS will kill it anyway; clean
 *                            close avoids a kernel-level reset on resume)
 *   AppState 'active'      → resume socket
 *   AppState 'inactive'    → ignore (transient: app switcher / Control
 *                            Center / incoming call — tearing down here
 *                            causes spurious reconnect storms)
 *   NetInfo offline → online edge → force reconnect (don't wait for TCP
 *                                    keepalive timeout to notice the dead
 *                                    socket after wifi↔cellular handoff)
 *   close 4001 → refreshSession() → a token rebuilds the socket now, no
 *                token (signed out) disconnects it.
 *
 * Provider does NOT register business event handlers — those live in
 * per-feature hooks so the realtime layer scales without one giant file.
 */
import NetInfo from "@react-native-community/netinfo";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { WSClient } from "./ws-client";

const RealtimeContext = createContext<WSClient | null>(null);

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
  /** Called on close 4001; resolves the new access token, or null when signed out. */
  refreshSession: () => Promise<string | null>;
  children: ReactNode;
}

export function RealtimeProvider({ userId, workspaceSlug, getToken, refreshSession, children }: RealtimeProviderProps) {
  const [client, setClient] = useState<WSClient | null>(null);

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
      return;
    }

    const ws = new WSClient({
      url: `${runtimeConfig().wsUrl}/api/v1/ws`,
      getToken: () => sessionRef.current.getToken(),
      workspaceSlug,
      clientOs: Platform.OS,
      logger: console,
      onSessionEnded: () => {
        sessionRef.current.refreshSession().then(
          (token) => (token ? ws.forceReconnect() : ws.disconnect()),
          // A transient failure keeps the session: the next foreground
          // return or network edge redials with whatever token is current.
          (err: unknown) => console.warn("[realtime] refresh failed after 4001", err),
        );
      },
    });
    ws.connect();
    setClient(ws);

    // ── AppState ────────────────────────────────────────────────
    const appStateSub = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") {
        // Foreground. The socket may have been paused (we put it there on
        // background) or it may be a zombie (iOS killed it silently).
        // resume() handles both with one fresh socket.
        ws.resume();
      } else if (status === "background") {
        ws.pause();
      }
      // 'inactive' (iOS-only, transient) → ignore.
    });

    // ── NetInfo ─────────────────────────────────────────────────
    lastConnectedRef.current = null;
    const netInfoUnsub = NetInfo.addEventListener((state) => {
      const isConnected = state.isConnected === true;
      const previous = lastConnectedRef.current;
      lastConnectedRef.current = isConnected;
      // Edge: false → true. First event (previous === null) is skipped —
      // connect()/resume() above already handle the initial state.
      if (previous === false && isConnected) {
        console.info("[realtime] netinfo: back online → forceReconnect");
        ws.forceReconnect();
      }
    });

    return () => {
      appStateSub.remove();
      netInfoUnsub();
      ws.disconnect();
      setClient(null);
    };
  }, [userId, workspaceSlug]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}
