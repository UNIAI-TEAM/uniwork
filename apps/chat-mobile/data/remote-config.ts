// UniChat's remote config: the slice of GET /api/v1/config the phone
// acts on — the oldest version the server still serves, the kill switches
// (mobile_flags) and the store pages the "Update required" screen opens. A
// store binary cannot be recalled, so this is how a broken release is stopped
// and a broken feature switched off.
//
// One query for the whole app, read at boot and on every return to the
// foreground (refetchOnWindowFocus "always"; data/query-client.ts bridges
// AppState to TanStack's focus). The organization of the open workspace
// targets the flags (`?organization_id=`); opening another workspace refetches.
// The last answer is kept on the device (REMOTE_CONFIG_STORE_KEY) and seeded
// into the query at the next launch, before the server is asked again: a kill
// switch and the minimum version hold through a cold start with no network.
// With
// no answer ever kept, or when the server is unreachable on a first launch,
// every flag reads its default and nothing is gated: the switches are for
// turning a feature off, never a reason to lock someone out of a working app.
import { queryOptions, useQuery, useQueryClient, type QueryClient, type QueryCacheNotifyEvent } from "@tanstack/react-query";
import { parseWithFallback } from "@uniwork/core/api/schema";
import { useEffect } from "react";
import { z } from "zod";
import { api, type ApiClient } from "./api";
import { bestEffort } from "./report";
import type { DeviceStore } from "./storage/device-store";

/** Every switch the app reads, at the value it has before (or without) an answer. */
export const MOBILE_FLAG_DEFAULTS = {
  // Calls: off hides calling and stops incoming calls from ringing (server: featureflags.unichat_mobile_calls).
  unichat_mobile_calls: true,
  // Photos and files: off hides attaching them in the composer (server: featureflags.unichat_mobile_media_upload).
  unichat_mobile_media_upload: true,
  // Voice messages: off hides recording one in the composer (server: featureflags.unichat_mobile_voice_messages).
  unichat_mobile_voice_messages: true,
  // "Bắt kịp nhanh": off hides the AI catch-up banner above the chat list (server: featureflags.unichat_mobile_ai_catch_up).
  unichat_mobile_ai_catch_up: true,
  // The outbox's automatic re-send: off stops data/owed.ts › flushOwed (server: featureflags.unichat_mobile_outbox_flush).
  unichat_mobile_outbox_flush: true,
  // Sending on once the app is off screen (data/outbox-drain/: iOS's borrowed time and scheduled task, Android's
  // WorkManager job): off leaves what is owed for the next time the app is open (server:
  // featureflags.unichat_mobile_background_send).
  unichat_mobile_background_send: true,
  // The chat change log: off makes a reconnect refetch every shown timeline again (server: featureflags.unichat_mobile_chat_sync).
  unichat_mobile_chat_sync: true,
  // The message list on FlashList 2 (components/chat/timeline-list.tsx): off keeps the tuned inverted FlatList; a share
  // of people on it is the A/B of the two lists (server: featureflags.unichat_mobile_timeline_recycled).
  unichat_mobile_timeline_recycled: false,
} as const satisfies Record<string, boolean>;

export type MobileFlag = keyof typeof MOBILE_FLAG_DEFAULTS;

export interface MobileRemoteConfig {
  /** "" when the server sets no minimum */
  minSupportedVersion: string;
  /** The version phones should be on: below it, a dismissible "new version" banner (components/app/update-nudge.tsx); "" for none. */
  recommendedVersion: string;
  flags: Partial<Record<string, boolean>>;
  /** The store page per platform; "" when that store has nothing published. */
  storeUrl: { ios: string; android: string };
}

export const REMOTE_CONFIG_FALLBACK: MobileRemoteConfig = {
  minSupportedVersion: "",
  recommendedVersion: "",
  flags: {},
  storeUrl: { ios: "", android: "" },
};

const text = z.string().catch("");
export const RemoteConfigSchema = z.object({
  min_supported_mobile_version: text.optional(),
  recommended_mobile_version: text.optional(),
  mobile_flags: z.record(z.string(), z.boolean().catch(true)).catch({}).optional(),
  unichat_stores: z
    .object({ ios: text.optional(), android: text.optional(), testflight: text.optional(), play_internal: text.optional() })
    .catch({})
    .optional(),
});
type RemoteConfigResponse = z.infer<typeof RemoteConfigSchema>;

export const remoteConfigKey = ["remote-config"] as const;

let organizationId: string | null = null;

/** GET /api/v1/config for the current organization, shaped for the phone; a malformed answer is the fallback. */
export async function fetchRemoteConfig(client: Pick<ApiClient, "request">, signal?: AbortSignal): Promise<MobileRemoteConfig> {
  const query = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : "";
  const raw = await client.request(`/api/v1/config${query}`, { signal });
  const parsed = parseWithFallback<RemoteConfigResponse | null>(raw, RemoteConfigSchema, null, { endpoint: "GET /api/v1/config" });
  if (!parsed) return REMOTE_CONFIG_FALLBACK;
  const stores = parsed.unichat_stores ?? {};
  return {
    minSupportedVersion: (parsed.min_supported_mobile_version ?? "").trim(),
    recommendedVersion: (parsed.recommended_mobile_version ?? "").trim(),
    flags: parsed.mobile_flags ?? {},
    // The pilot links stand in while the public store page is empty (the server's own rule for /unichat).
    storeUrl: { ios: stores.ios || stores.testflight || "", android: stores.android || stores.play_internal || "" },
  };
}

export const remoteConfigOptions = () =>
  queryOptions({
    queryKey: remoteConfigKey,
    queryFn: ({ signal }) => fetchRemoteConfig(api, signal),
    staleTime: 5 * 60_000,
    gcTime: Infinity,
    refetchOnWindowFocus: "always",
    retry: 2,
  });

let lacking: ReadonlySet<MobileFlag> = new Set();

/**
 * The switches this binary was built without (lib/runtime-extra.ts › lackingFlags; data/boot.ts sets them before
 * the first screen): they read off, default and server answer alike.
 */
export function setBuildLacks(flags: readonly MobileFlag[]): void {
  lacking = new Set(flags);
}

/** The switch's value in a config, or its default when the config (or the key) is missing; off when the build lacks it. */
export function flagValue(config: MobileRemoteConfig | undefined, name: MobileFlag): boolean {
  if (lacking.has(name)) return false;
  return config?.flags[name] ?? MOBILE_FLAG_DEFAULTS[name];
}

/** Outside React (the call engine): the last answer in the cache, else the default. */
export function readMobileFlag(queryClient: Pick<QueryClient, "getQueryData">, name: MobileFlag): boolean {
  return flagValue(queryClient.getQueryData<MobileRemoteConfig>(remoteConfigKey), name);
}

/**
 * The organization the flags are evaluated for; the workspace layout calls it
 * with the open workspace's. A change refetches, so a switch set for one
 * organization never sticks to another.
 */
export function useRemoteConfigOrganization(id: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (organizationId === id) return;
    organizationId = id;
    void queryClient.invalidateQueries({ queryKey: remoteConfigKey });
  }, [id, queryClient]);
}

/**
 * A sign-out forgets everything the account cached except the remote-config
 * query itself: the update gate at the root observes it for the life of the
 * app, and removing it (queryClient.clear()) would leave that observer on a
 * query nothing refetches, the gate frozen on the old minimum. The switches
 * can differ per person and organization, so they are dropped — in memory and
 * in the copy kept on the device (forgetKeptFlags) — and the answer is asked
 * again, for no organization until the next workspace opens: the next person
 * on this phone runs on the defaults until the server answers for them, never
 * on the last person's switches, even after an offline cold start. The
 * minimum version and the store pages are the same for everyone and stay.
 */
export function clearAccountCache(
  queryClient: Pick<QueryClient, "removeQueries" | "getMutationCache" | "invalidateQueries" | "setQueryData">,
  openStore?: () => Promise<DeviceStore>,
): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== remoteConfigKey[0] });
  queryClient.getMutationCache().clear();
  organizationId = null;
  queryClient.setQueryData<MobileRemoteConfig>(remoteConfigKey, (config) => config && { ...config, flags: {} });
  if (openStore) void forgetKeptFlags(openStore).catch(bestEffort("remote-config", "kept switches not dropped", "breadcrumb"));
  void queryClient.invalidateQueries({ queryKey: remoteConfigKey });
}

export function useRemoteConfig() {
  return useQuery(remoteConfigOptions());
}

/** A kill switch for a screen: its default until the server answers, then the server's word. */
export function useMobileFlag(name: MobileFlag): boolean {
  const { data } = useQuery({ ...remoteConfigOptions(), select: (config: MobileRemoteConfig) => flagValue(config, name) });
  return data ?? flagValue(undefined, name);
}

/** Where the last answer lives on the device; the version is the shape of what is kept. */
export const REMOTE_CONFIG_STORE_KEY = "remote-config/v1";
/** A kept answer older than this is dropped: a month-old switch says nothing about today. */
export const REMOTE_CONFIG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const StoredRemoteConfigSchema = z.object({
  savedAt: z.number(),
  config: z.object({
    minSupportedVersion: z.string(),
    // Absent in a copy kept by a build from before the nudge: no nudge until the server answers.
    recommendedVersion: z.string().catch(""),
    flags: z.record(z.string(), z.boolean()),
    storeUrl: z.object({ ios: z.string(), android: z.string() }),
  }),
});

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Seeds the query with the last answer kept on the device, dated when it was
 * received: stale, so the first observer asks the server at once, and until
 * it answers the gate and the switches act on what the server last said. An
 * answer that arrived first wins; a copy that does not read, or is too old, is
 * removed. True when a copy was seeded.
 */
export async function restoreRemoteConfig(
  queryClient: Pick<QueryClient, "getQueryData" | "setQueryData">,
  openStore: () => Promise<DeviceStore>,
  now = Date.now(),
): Promise<boolean> {
  const store = await openStore();
  const raw = store.getString(REMOTE_CONFIG_STORE_KEY);
  if (raw === undefined) return false;
  const parsed = StoredRemoteConfigSchema.safeParse(parseJson(raw));
  if (!parsed.success || now - parsed.data.savedAt > REMOTE_CONFIG_MAX_AGE_MS) {
    store.remove(REMOTE_CONFIG_STORE_KEY);
    return false;
  }
  if (queryClient.getQueryData(remoteConfigKey) !== undefined) return false;
  queryClient.setQueryData<MobileRemoteConfig>(remoteConfigKey, parsed.data.config, { updatedAt: parsed.data.savedAt });
  return true;
}

/** The kept answer without its switches (they were the last person's); a copy that does not read is removed. */
export async function forgetKeptFlags(openStore: () => Promise<DeviceStore>): Promise<void> {
  const store = await openStore();
  const raw = store.getString(REMOTE_CONFIG_STORE_KEY);
  if (raw === undefined) return;
  const parsed = StoredRemoteConfigSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    store.remove(REMOTE_CONFIG_STORE_KEY);
    return;
  }
  store.set(REMOTE_CONFIG_STORE_KEY, JSON.stringify({ ...parsed.data, config: { ...parsed.data.config, flags: {} } }));
}

/** Keeps every answer the server gives on the device (not a seeded copy written back); returns the unsubscribe. */
export function persistRemoteConfig(
  queryClient: Pick<QueryClient, "getQueryCache">,
  openStore: () => Promise<DeviceStore>,
  now: () => number = Date.now,
): () => void {
  return queryClient.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (event.type !== "updated" || event.action.type !== "success" || event.action.manual) return;
    if (event.query.queryKey[0] !== remoteConfigKey[0]) return;
    const config = event.query.state.data as MobileRemoteConfig;
    void openStore()
      .then((store) => store.set(REMOTE_CONFIG_STORE_KEY, JSON.stringify({ savedAt: now(), config })))
      .catch(bestEffort("remote-config", "answer not kept", "breadcrumb"));
  });
}
