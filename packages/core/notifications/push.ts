"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/notifications";
import { getPushAdapter, type PushPermission } from "../platform/push-adapter";
import { usePushConfig } from "./hooks";

const subscriptionKey = ["notifications", "push-subscription"] as const;

/** Ask the browser, then register with the server. Throws when permission is refused. */
export async function enablePush(publicKey: string): Promise<void> {
  const a = getPushAdapter();
  if (!a) throw new Error("push_unsupported");
  const perm = await a.requestPermission();
  if (perm !== "granted") throw new Error("push_denied");
  const sub = await a.subscribe(publicKey);
  await api.subscribePush(sub);
}

/** Unsubscribe in the browser first so a server failure cannot leave a live subscription nobody tracks. */
export async function disablePush(): Promise<void> {
  const a = getPushAdapter();
  if (!a) return;
  const endpoint = await a.unsubscribe();
  if (endpoint) await api.unsubscribePush(endpoint);
}

export interface PushState {
  /** Server has VAPID keys and the host injected an adapter. */
  available: boolean;
  permission: PushPermission;
  /** This browser holds a subscription. */
  subscribed: boolean;
  isLoading: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  isPending: boolean;
}

/** One hook for the settings switch: availability, current state, and the two actions. */
export function usePush(): PushState {
  const qc = useQueryClient();
  const config = usePushConfig();
  const adapter = getPushAdapter();
  const available = !!config.data?.enabled && !!adapter && adapter.permission() !== "unsupported";
  const current = useQuery({
    queryKey: subscriptionKey,
    queryFn: () => adapter!.current(),
    enabled: available,
  });
  const enable = useMutation({
    mutationFn: () => enablePush(config.data?.public_key ?? ""),
    onSettled: () => qc.invalidateQueries({ queryKey: subscriptionKey }),
  });
  const disable = useMutation({
    mutationFn: disablePush,
    onSettled: () => qc.invalidateQueries({ queryKey: subscriptionKey }),
  });
  return {
    available,
    permission: adapter?.permission() ?? "unsupported",
    subscribed: !!current.data,
    isLoading: config.isLoading || (available && current.isLoading),
    enable: () => enable.mutateAsync(),
    disable: () => disable.mutateAsync(),
    isPending: enable.isPending || disable.isPending,
  };
}
