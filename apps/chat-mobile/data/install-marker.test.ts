import { afterEach, describe, expect, it } from "vitest";
import { firstLaunchOfInstall } from "./install-marker";
import { installDeviceStore, memoryDeviceStore, type DeviceStore } from "./storage/device-store";

/** A store that keeps what it is given, as the MMKV file of one install does. */
function durableStore(seed: Record<string, string> = {}): DeviceStore {
  const memory = memoryDeviceStore();
  for (const [key, value] of Object.entries(seed)) memory.set(key, value);
  return { ...memory, durable: true };
}

afterEach(() => installDeviceStore(() => Promise.resolve(memoryDeviceStore())));

describe("firstLaunchOfInstall", () => {
  it("is true once for a new install, and marks it", async () => {
    const store = durableStore();
    installDeviceStore(() => Promise.resolve(store));
    expect(await firstLaunchOfInstall(() => 42)).toBe(true);
    expect(store.getString("install/marker")).toBe("42");
    installDeviceStore(() => Promise.resolve(store));
    expect(await firstLaunchOfInstall()).toBe(false);
  });

  it("is false for an upgrade from a build before the marker: its store already holds keys", async () => {
    const store = durableStore({ "locale_synced:u1": "vi" });
    installDeviceStore(() => Promise.resolve(store));
    expect(await firstLaunchOfInstall()).toBe(false);
    expect(store.getString("install/marker")).toBeDefined();
  });

  it("never wipes on the word of a store that lives in memory this launch", async () => {
    installDeviceStore(() => Promise.resolve(memoryDeviceStore()));
    expect(await firstLaunchOfInstall()).toBe(false);
  });
});
