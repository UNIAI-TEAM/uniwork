import { beforeEach, describe, expect, it, vi } from "vitest";

const keychain = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: vi.fn(async (key: string) => keychain.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => void keychain.set(key, value)),
}));
vi.mock("expo-crypto", () => ({ getRandomBytesAsync: vi.fn(async (n: number) => new Uint8Array(n).map((_, i) => i * 7)) }));
const createMMKV = vi.hoisted(() => vi.fn((config: unknown) => ({ config })));
vi.mock("react-native-mmkv", () => ({ createMMKV }));

import * as SecureStore from "expo-secure-store";
import { installReportSink } from "../report";
import { openNativeDeviceStore } from "./native-device-store";

beforeEach(() => {
  keychain.clear();
  createMMKV.mockClear();
});

describe("native device store", () => {
  it("encrypts MMKV with AES-256 under a random key kept in the Keychain, reused on the next launch", async () => {
    await openNativeDeviceStore();
    const key = keychain.get("uniwork_chat_store_key")!;
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("uniwork_chat_store_key", key, { keychainAccessible: "afterFirstUnlockThisDeviceOnly" });
    expect(createMMKV).toHaveBeenLastCalledWith({ id: "uniwork-chat", encryptionKey: key, encryptionType: "AES-256" });

    await openNativeDeviceStore();
    expect(createMMKV).toHaveBeenLastCalledWith(expect.objectContaining({ encryptionKey: key }));
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it("without a key or the native module, the launch runs on memory and says so", async () => {
    const breadcrumbs: string[] = [];
    installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void breadcrumbs.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
    try {
      createMMKV.mockImplementationOnce(() => {
        throw new Error("no native module");
      });
      const store = await openNativeDeviceStore();
      store.set("a", "1");
      expect(store.getString("a")).toBe("1");
      vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce("locked");
      await openNativeDeviceStore();
      expect(breadcrumbs.filter((m) => m.includes("device store unavailable"))).toHaveLength(2);
    } finally {
      installReportSink(null);
    }
  });
});
