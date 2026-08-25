"use client";

import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { getAccessToken, subscribe as subscribeToToken } from "../api/session";
import { WSClient } from "../api/ws-client";
import { useAuthStore } from "../auth/store";
import { createLogger } from "../logger";
import { runtimeConfig } from "../runtime-config";

interface WSContextValue {
  /** null until the socket for the current workspace exists. */
  client: WSClient | null;
}

const WSContext = createContext<WSContextValue | null>(null);

export interface WSProviderProps {
  children: ReactNode;
  /**
   * `{orgSlug}/{workspaceSlug}` — workspace slugs are unique only within an
   * organization, so the server resolves the pair, not a bare slug.
   */
  workspaceSlug: string;
}

/**
 * Owns one WSClient per (user, workspace). The token is delivered as the
 * first frame (never in the URL, where proxies and history would log it),
 * and the socket is rebuilt when the token rotates so a refreshed session
 * does not keep talking on an expired one.
 */
export function WSProvider({ children, workspaceSlug }: WSProviderProps) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [client, setClient] = useState<WSClient | null>(null);

  useEffect(() => subscribeToToken(() => setToken(getAccessToken())), []);

  useEffect(() => {
    if (!userId || !token || !workspaceSlug) {
      setClient(null);
      return;
    }
    const ws = new WSClient(`${runtimeConfig().wsUrl}/api/v1/ws`, {
      logger: createLogger("ws"),
      identity: { platform: "web" },
    });
    ws.setAuth(token, workspaceSlug);
    ws.connect();
    setClient(ws);
    return () => {
      ws.disconnect();
      setClient(null);
    };
  }, [userId, token, workspaceSlug]);

  return <WSContext.Provider value={{ client }}>{children}</WSContext.Provider>;
}

export function useWS(): WSContextValue {
  const ctx = use(WSContext);
  if (!ctx) throw new Error("useWS must be used within WSProvider");
  return ctx;
}

/** Non-throwing read for hooks that must also work outside a workspace. */
export function useOptionalWS(): WSContextValue | null {
  return use(WSContext);
}
