// What the socket does when the app leaves the front and comes back.
// Closing it the instant the app went to the
// background cost a full reconnect on every app switch — copying an OTP and
// coming back meant a new socket, its scope replay and a refetch of every
// shown timeline. Like Slack and WhatsApp, the socket now stays for a short
// grace (BACKGROUND_GRACE_MS, inside what the OS allows a backgrounded app)
// and is paused only if the app is still away when it runs out; back within
// it, nothing is torn down and nothing refetches. Pure: realtime-provider.tsx
// hands it the socket, AppState and the timers.
//
// Coming back:
//   - a paused, unauthenticated or never-opened socket gets one fresh socket,
//     as before;
//   - away longer than the grace with the socket still up means the pause
//     never ran (iOS suspends JavaScript, timers included): what is left is
//     probably a zombie, so it is replaced too;
//   - back within the grace, the socket is asked for a pong now rather than
//     at the next 25 s heartbeat, so a socket the OS cut meanwhile is
//     replaced within the heartbeat's 10 s timeout instead of 35 s.
// A call that holds the socket open (`holdOpen`) is never paused by this.
import type { ConnectionState } from "./ws-types";

export const BACKGROUND_GRACE_MS = 25_000;

export interface GraceSocket {
  pause(): void;
  resume(): void;
  /** A heartbeat now: no pong in time and the socket is replaced. */
  probe(): void;
  getConnectionState(): ConnectionState;
  isAuthenticated(): boolean;
}

export interface GraceEnv {
  holdOpen: () => boolean;
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

export interface BackgroundGrace {
  /** AppState's change event; "inactive" (app switcher, Control Center, a call sheet) changes nothing. */
  onAppState(status: string): void;
  /** The provider unmounts: no pause fires afterwards. */
  dispose(): void;
}

export function createBackgroundGrace(socket: GraceSocket, env: GraceEnv, graceMs = BACKGROUND_GRACE_MS): BackgroundGrace {
  let timer: unknown = null;
  let backgroundedAt: number | null = null;
  const cancel = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };
  return {
    onAppState(status) {
      if (status === "background") {
        if (env.holdOpen() || timer !== null) return;
        backgroundedAt = env.now();
        timer = env.setTimer(() => {
          timer = null;
          // A call that started inside the grace rings over this socket; the provider pauses it once the call ends.
          if (env.holdOpen()) return;
          socket.pause();
        }, graceMs);
        return;
      }
      if (status !== "active") return;
      const away = backgroundedAt === null ? 0 : env.now() - backgroundedAt;
      backgroundedAt = null;
      cancel();
      if (socket.getConnectionState() === "offline" || !socket.isAuthenticated() || away >= graceMs) socket.resume();
      else socket.probe();
    },
    dispose: cancel,
  };
}
