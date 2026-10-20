/**
 * Boilerplate-killer for the Layer-3 realtime hooks.
 * Ported from usf apps/mobile/lib/use-ws-subscriptions.ts
 *
 * Every `use-X-realtime` hook used to repeat this same shape:
 *
 *   const ws = useWSClient();
 *   useEffect(() => {
 *     if (!ws) return;
 *     const unsubs = [ ws.on(...), ws.on(...), ws.onReconnect(...) ];
 *     return () => { for (const u of unsubs) u(); };
 *   }, [ws, ...]);
 *
 * `useWSSubscriptions(setup, deps)` collapses the lifecycle scaffolding so
 * each hook focuses on its actual subscription list. The `setup` callback
 * runs only when the client is non-null, receives it, and returns the array
 * of unsubs to wire into cleanup.
 *
 * Per-record hooks pass their record id via the deps array (so it
 * re-subscribes when navigating between records). They can also access
 * other narrow-scoped values via closure from the calling component. The
 * workspace id is one of those: the provider is mounted per workspace, so
 * a hook reads it from where it reads its query keys.
 */
import { useEffect } from "react";
import { useWSClient } from "@/data/realtime/realtime-provider";
import type { WSClient } from "@/data/realtime/ws-client";

export type WSSubscriptionSetup = (ws: WSClient) => (() => void)[] | undefined;

export function useWSSubscriptions(setup: WSSubscriptionSetup, deps: readonly unknown[]) {
  const ws = useWSClient();

  useEffect(() => {
    if (!ws) return;
    const unsubs = setup(ws) ?? [];
    return () => {
      for (const u of unsubs) u();
    };
    // setup is intentionally NOT in deps — callers control re-subscription
    // via the explicit `deps` array. Putting setup in deps would re-fire
    // on every render (closures), defeating the whole point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, ...deps]);
}
