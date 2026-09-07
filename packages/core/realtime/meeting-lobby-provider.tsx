"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getGuestSession } from "../api/guest-session";
import { getAccessToken, subscribe as subscribeToToken } from "../api/session";
import { WSClient } from "../api/ws-client";
import { useAuthStore } from "../auth/store";
import { createLogger } from "../logger";
import { runtimeConfig } from "../runtime-config";

interface WSContextValue {
  client: WSClient | null;
}

const MeetingLobbyWSContext = createContext<WSContextValue | null>(null);
export function useOptionalMeetingLobbyWS(): WSContextValue | null {
  return useContext(MeetingLobbyWSContext);
}

/** Public meeting lobby WebSocket — no workspace membership required. */
export function MeetingLobbyWSProvider({
  meetingId,
  children,
}: {
  meetingId: string;
  children: ReactNode;
}) {
  const authStatus = useAuthStore((s) => s.status);
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [client, setClient] = useState<WSClient | null>(null);

  useEffect(() => subscribeToToken(() => setToken(getAccessToken())), []);

  useEffect(() => {
    if (!meetingId) {
      setClient(null);
      return;
    }
    const url = `${runtimeConfig().wsUrl}/api/v1/meetings/${encodeURIComponent(meetingId)}/lobby-ws`;
    const guestSession = authStatus !== "authed" ? getGuestSession() : null;
    const ws = new WSClient(url, {
      logger: createLogger("meeting-lobby-ws"),
      // Prefer first-frame guest_session over cookies — cross-origin dev often
      // has X-Guest-Session on HTTP but no uw_guest on the WS upgrade.
      cookieAuth: authStatus !== "authed" && !guestSession,
      guestSession,
      identity: { platform: "web" },
    });
    if (authStatus === "authed" && token) {
      ws.setAuth(token, "");
    }
    ws.connect();
    setClient(ws);
    return () => {
      ws.disconnect();
      setClient(null);
    };
  }, [meetingId, authStatus, token]);

  return (
    <MeetingLobbyWSContext.Provider value={{ client }}>
      {children}
    </MeetingLobbyWSContext.Provider>
  );
}
