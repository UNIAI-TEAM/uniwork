import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  effect: undefined as (() => void) | undefined,
  queryData: undefined as unknown,
  lastQuery: undefined as Record<string, unknown> | undefined,
  invalidate: vi.fn(async () => {}),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void) => {
    hooks.effect = effect;
  },
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: Record<string, unknown>) => {
    hooks.lastQuery = options;
    const select = options.select as ((data: unknown) => unknown) | undefined;
    return { data: hooks.queryData === undefined ? undefined : select ? select(hooks.queryData) : hooks.queryData };
  },
  useQueryClient: () => ({ invalidateQueries: hooks.invalidate }),
}));
const apiMock = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
vi.mock("./api", () => ({ api: apiMock }));

import { QueryClient } from "@tanstack/react-query";
import { memoryDeviceStore } from "./storage/device-store";
import {
  clearAccountCache,
  fetchRemoteConfig,
  forgetKeptFlags,
  persistRemoteConfig,
  REMOTE_CONFIG_MAX_AGE_MS,
  REMOTE_CONFIG_STORE_KEY,
  restoreRemoteConfig,
  flagValue,
  readMobileFlag,
  REMOTE_CONFIG_FALLBACK,
  remoteConfigKey,
  remoteConfigOptions,
  useMobileFlag,
  useRemoteConfig,
  useRemoteConfigOrganization,
  type MobileRemoteConfig,
} from "./remote-config";

beforeEach(() => {
  apiMock.request.mockReset();
  hooks.queryData = undefined;
  hooks.invalidate.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const config = (over: Partial<MobileRemoteConfig> = {}): MobileRemoteConfig => ({ ...REMOTE_CONFIG_FALLBACK, ...over });

describe("fetchRemoteConfig", () => {
  it("reads the minimum, the switches and each platform's store page", async () => {
    apiMock.request.mockResolvedValueOnce({
      flags: { rum_sampling: true },
      min_supported_mobile_version: " 0.3.0 ",
      mobile_flags: { unichat_mobile_calls: false },
      unichat_stores: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x", testflight: "", play_internal: "" },
    });
    const signal = new AbortController().signal;
    expect(await fetchRemoteConfig(apiMock, signal)).toEqual({
      minSupportedVersion: "0.3.0",
      flags: { unichat_mobile_calls: false },
      storeUrl: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" },
    });
    expect(apiMock.request).toHaveBeenCalledWith("/api/v1/config", { signal });
  });

  it("falls back to the pilot links while a store page is empty", async () => {
    apiMock.request.mockResolvedValueOnce({ unichat_stores: { testflight: "https://testflight.apple.com/join/x", play_internal: "https://play.google.com/apps/internaltest/1" } });
    expect((await fetchRemoteConfig(apiMock)).storeUrl).toEqual({ ios: "https://testflight.apple.com/join/x", android: "https://play.google.com/apps/internaltest/1" });
  });

  it("degrades a malformed answer: no gate, default switches, no store", async () => {
    // An older server (no mobile fields) and garbage in each field.
    apiMock.request.mockResolvedValueOnce({ flags: {} });
    expect(await fetchRemoteConfig(apiMock)).toEqual(REMOTE_CONFIG_FALLBACK);
    apiMock.request.mockResolvedValueOnce({ min_supported_mobile_version: 3, mobile_flags: { unichat_mobile_calls: "no" }, unichat_stores: [] });
    expect(await fetchRemoteConfig(apiMock)).toEqual({ minSupportedVersion: "", flags: { unichat_mobile_calls: true }, storeUrl: { ios: "", android: "" } });
    apiMock.request.mockResolvedValueOnce({ mobile_flags: "off" });
    expect((await fetchRemoteConfig(apiMock)).flags).toEqual({});
    apiMock.request.mockResolvedValueOnce("<html>");
    expect(await fetchRemoteConfig(apiMock)).toEqual(REMOTE_CONFIG_FALLBACK);
    apiMock.request.mockResolvedValueOnce(undefined);
    expect(await fetchRemoteConfig(apiMock)).toEqual(REMOTE_CONFIG_FALLBACK);
  });
});

describe("flags", () => {
  it("read the server's value, else the default", () => {
    expect(flagValue(undefined, "unichat_mobile_calls")).toBe(true);
    expect(flagValue(config(), "unichat_mobile_calls")).toBe(true);
    expect(flagValue(config({ flags: { unichat_mobile_calls: false } }), "unichat_mobile_calls")).toBe(false);
  });

  it("are readable outside React from the cached answer", () => {
    const getQueryData = vi.fn(() => config({ flags: { unichat_mobile_calls: false } }));
    expect(readMobileFlag({ getQueryData } as never, "unichat_mobile_calls")).toBe(false);
    expect(getQueryData).toHaveBeenCalledWith(remoteConfigKey);
    expect(readMobileFlag({ getQueryData: () => undefined } as never, "unichat_mobile_calls")).toBe(true);
  });
});

describe("remoteConfigOptions", () => {
  it("asks at boot and on every foreground return, for the organization of the open workspace", async () => {
    const options = remoteConfigOptions();
    expect(options).toMatchObject({ queryKey: remoteConfigKey, refetchOnWindowFocus: "always", retry: 2 });
    apiMock.request.mockResolvedValue({});
    const signal = new AbortController().signal;
    await (options.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>)({ signal });
    expect(apiMock.request).toHaveBeenLastCalledWith("/api/v1/config", { signal });

    useRemoteConfigOrganization("org 1");
    hooks.effect?.();
    expect(hooks.invalidate).toHaveBeenCalledWith({ queryKey: remoteConfigKey });
    await (options.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>)({ signal });
    expect(apiMock.request).toHaveBeenLastCalledWith("/api/v1/config?organization_id=org%201", { signal });

    // the same organization again changes nothing
    hooks.invalidate.mockClear();
    hooks.effect?.();
    expect(hooks.invalidate).not.toHaveBeenCalled();
    useRemoteConfigOrganization(null);
    hooks.effect?.();
    expect(hooks.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("hooks", () => {
  it("useRemoteConfig is the one query", () => {
    hooks.queryData = config({ minSupportedVersion: "0.3.0" });
    expect(useRemoteConfig().data).toEqual(config({ minSupportedVersion: "0.3.0" }));
    expect(hooks.lastQuery?.queryKey).toEqual(remoteConfigKey);
  });

  it("useMobileFlag reads the default before an answer, then the server's word", () => {
    expect(useMobileFlag("unichat_mobile_calls")).toBe(true);
    hooks.queryData = config({ flags: { unichat_mobile_calls: false } });
    expect(useMobileFlag("unichat_mobile_calls")).toBe(false);
  });
});

describe("clearAccountCache (sign-out)", () => {
  it("drops every query and mutation of the account but keeps the remote config, refetched for no organization", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["chat", "ws1", "rooms"], [{ id: "r1" }]);
    client.setQueryData(remoteConfigKey, config({ minSupportedVersion: "0.3.0" }));
    client.getMutationCache().build(client, { mutationKey: ["devices", "revoke"] });
    // The last workspace was in org-1; the next account may not be.
    useRemoteConfigOrganization("org-1");
    hooks.effect?.();
    apiMock.request.mockResolvedValue({ min_supported_mobile_version: "0.4.0" });

    clearAccountCache(client);

    expect(client.getQueryData(["chat", "ws1", "rooms"])).toBeUndefined();
    expect(client.getMutationCache().getAll()).toEqual([]);
    // Kept (the gate's observer stays live), marked stale and asked again without the old organization.
    expect(client.getQueryState(remoteConfigKey)?.isInvalidated).toBe(true);
    expect((await client.fetchQuery(remoteConfigOptions())).minSupportedVersion).toBe("0.4.0");
    expect(apiMock.request).toHaveBeenLastCalledWith("/api/v1/config", expect.anything());
    client.clear();
  });
});


// Audit (Release, missed): the kill switch and the minimum version failed open on every cold start without a network,
// because the last answer lived only in memory. It is kept on the device and seeded at the next launch.
describe("the last answer kept on the device", () => {
  const killed: MobileRemoteConfig = { minSupportedVersion: "0.4.0", flags: { unichat_mobile_calls: false }, storeUrl: { ios: "", android: "https://play.example/uc" } };
  const NOW = 1_800_000_000_000;

  it("keeps each answer the server gives, and seeds it, stale, at the next launch", async () => {
    const store = memoryDeviceStore();
    const open = vi.fn(async () => store);
    const first = new QueryClient();
    const stop = persistRemoteConfig(first, open, () => NOW - 60_000);
    apiMock.request.mockResolvedValueOnce({ min_supported_mobile_version: "0.4.0", mobile_flags: { unichat_mobile_calls: false }, unichat_stores: { android: "https://play.example/uc" } });
    await first.fetchQuery({ queryKey: remoteConfigKey, queryFn: () => fetchRemoteConfig(apiMock) });
    await vi.waitFor(() => expect(store.getString(REMOTE_CONFIG_STORE_KEY)).toBeDefined());
    expect(JSON.parse(store.getString(REMOTE_CONFIG_STORE_KEY) ?? "")).toEqual({ savedAt: NOW - 60_000, config: killed });
    // Other queries are not the remote config's to keep.
    first.setQueryData(["workspaces"], []);
    await first.fetchQuery({ queryKey: ["chat", "x"], queryFn: async () => 1 });
    stop();

    const next = new QueryClient();
    const keeping = persistRemoteConfig(next, open, () => NOW);
    expect(await restoreRemoteConfig(next, open, NOW)).toBe(true);
    expect(next.getQueryData(remoteConfigKey)).toEqual(killed);
    expect(readMobileFlag(next, "unichat_mobile_calls")).toBe(false);
    // Dated when the server said it: the first observer asks again at once.
    expect(next.getQueryState(remoteConfigKey)?.dataUpdatedAt).toBe(NOW - 60_000);
    // The seed is not written back as a fresh answer.
    await Promise.resolve();
    expect(JSON.parse(store.getString(REMOTE_CONFIG_STORE_KEY) ?? "").savedAt).toBe(NOW - 60_000);
    keeping();
  });

  it("lets an answer that arrived first win, and seeds nothing without a copy", async () => {
    const store = memoryDeviceStore();
    store.set(REMOTE_CONFIG_STORE_KEY, JSON.stringify({ savedAt: NOW, config: killed }));
    const client = new QueryClient();
    client.setQueryData(remoteConfigKey, REMOTE_CONFIG_FALLBACK);
    expect(await restoreRemoteConfig(client, async () => store, NOW)).toBe(false);
    expect(client.getQueryData(remoteConfigKey)).toBe(REMOTE_CONFIG_FALLBACK);
    expect(await restoreRemoteConfig(new QueryClient(), async () => memoryDeviceStore(), NOW)).toBe(false);
  });

  it.each([
    ["does not read", "{"],
    ["has another shape", JSON.stringify({ savedAt: NOW, config: { flags: "off" } })],
    ["is too old", JSON.stringify({ savedAt: NOW - REMOTE_CONFIG_MAX_AGE_MS - 1, config: killed })],
  ])("drops a copy that %s", async (_why, raw) => {
    const store = memoryDeviceStore();
    store.set(REMOTE_CONFIG_STORE_KEY, raw);
    const client = new QueryClient();
    expect(await restoreRemoteConfig(client, async () => store, NOW)).toBe(false);
    expect(client.getQueryData(remoteConfigKey)).toBeUndefined();
    expect(store.getString(REMOTE_CONFIG_STORE_KEY)).toBeUndefined();
  });

  // Audit (remote-config-thin): the kept copy sits outside any account, so a sign-out must not leave the last
  // person's per-user or per-organization switches to the next person on an offline cold start.
  it("a sign-out drops the switches, in memory and kept, and keeps the minimum version and the store pages", async () => {
    const store = memoryDeviceStore();
    store.set(REMOTE_CONFIG_STORE_KEY, JSON.stringify({ savedAt: NOW, config: killed }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(remoteConfigKey, killed);
    apiMock.request.mockReturnValue(new Promise(() => undefined));
    clearAccountCache(client, async () => store);
    expect(client.getQueryData(remoteConfigKey)).toEqual({ ...killed, flags: {} });
    expect(readMobileFlag(client, "unichat_mobile_calls")).toBe(true);
    expect(client.getQueryState(remoteConfigKey)?.isInvalidated).toBe(true);
    await vi.waitFor(() => expect(JSON.parse(store.getString(REMOTE_CONFIG_STORE_KEY) ?? "")).toEqual({ savedAt: NOW, config: { ...killed, flags: {} } }));
    // The next launch, offline, seeds the minimum version and no one's switches.
    const next = new QueryClient();
    expect(await restoreRemoteConfig(next, async () => store, NOW)).toBe(true);
    expect(next.getQueryData(remoteConfigKey)).toEqual({ ...killed, flags: {} });
    client.clear();
  });

  it("forgets nothing without a kept copy, removes one that does not read, and a store that cannot open is a breadcrumb", async () => {
    const empty = memoryDeviceStore();
    await forgetKeptFlags(async () => empty);
    expect(empty.getString(REMOTE_CONFIG_STORE_KEY)).toBeUndefined();
    const broken = memoryDeviceStore();
    broken.set(REMOTE_CONFIG_STORE_KEY, "{");
    await forgetKeptFlags(async () => broken);
    expect(broken.getString(REMOTE_CONFIG_STORE_KEY)).toBeUndefined();
    // Without a cache (nothing answered yet) a sign-out sets nothing; a store that will not open is left to a breadcrumb.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clearAccountCache(client, () => Promise.reject(new Error("keystore")));
    expect(client.getQueryData(remoteConfigKey)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("leaves a store that cannot open to a breadcrumb", async () => {
    const client = new QueryClient();
    const stop = persistRemoteConfig(client, () => Promise.reject(new Error("keystore")));
    await client.fetchQuery({ queryKey: remoteConfigKey, queryFn: async () => killed });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getQueryData(remoteConfigKey)).toEqual(killed);
    stop();
  });
});
