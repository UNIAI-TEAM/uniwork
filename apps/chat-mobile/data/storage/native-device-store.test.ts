import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keychain = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: vi.fn(async (key: string) => keychain.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => void keychain.set(key, value)),
}));
vi.mock("expo-crypto", () => ({ getRandomBytesAsync: vi.fn(async (n: number) => new Uint8Array(n).map((_, i) => i * 7)) }));
// A stand-in for MMKV: files by id, each a map, readable with any key (the real one is not, which is the point).
const files = vi.hoisted(() => new Map<string, Map<string, string>>());
const createMMKV = vi.hoisted(() =>
  vi.fn((config: { id: string }) => {
    const values = files.get(config.id) ?? new Map<string, string>();
    files.set(config.id, values);
    return {
      config,
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => void values.set(key, value),
      remove: (key: string) => values.delete(key),
      getAllKeys: () => [...values.keys()],
    };
  }),
);
vi.mock("react-native-mmkv", () => ({
  createMMKV,
  existsMMKV: (id: string) => files.has(id),
  deleteMMKV: (id: string) => files.delete(id),
}));

import * as SecureStore from "expo-secure-store";
import { installReportSink } from "../report";
import { KEY_READ_ATTEMPTS, openNativeDeviceStore } from "./native-device-store";

const breadcrumbs: string[] = [];
const reports: { message: string; tags: Record<string, string> }[] = [];
const wait = vi.fn(async () => undefined);

beforeEach(() => {
  keychain.clear();
  files.clear();
  createMMKV.mockClear();
  vi.mocked(SecureStore.getItemAsync).mockClear();
  vi.mocked(SecureStore.setItemAsync).mockClear();
  wait.mockClear();
  breadcrumbs.length = 0;
  reports.length = 0;
  installReportSink({
    captureException: (error, context) => void reports.push({ message: error instanceof Error ? error.message : String(error), tags: context.tags }),
    addBreadcrumb: (b) => void breadcrumbs.push(b.message),
    setUser: vi.fn(),
    setTag: vi.fn(),
  });
});
afterEach(() => installReportSink(null));

describe("native device store", () => {
  it("encrypts MMKV with AES-256 under a random key kept in the Keychain, reused on the next launch", async () => {
    const store = await openNativeDeviceStore({ wait });
    const key = keychain.get("uniwork_chat_store_key")!;
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("uniwork_chat_store_key", key, { keychainAccessible: "afterFirstUnlockThisDeviceOnly" });
    expect(createMMKV).toHaveBeenLastCalledWith({ id: "uniwork-chat", encryptionKey: key, encryptionType: "AES-256" });
    expect(store.durable).toBe(true);
    store.set("a", "1");
    store.set("b", "2");
    expect(store.remove("b")).toBe(true);
    expect(store.keys()).toEqual(["a"]);

    const again = await openNativeDeviceStore({ wait });
    expect(createMMKV).toHaveBeenLastCalledWith(expect.objectContaining({ encryptionKey: key }));
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(again.getString("a")).toBe("1");
    expect(reports).toEqual([]);
  });

  it("a Keychain read that throws (locked before first unlock) is tried again before the disk is given up", async () => {
    keychain.set("uniwork_chat_store_key", "k".repeat(32));
    vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("locked")).mockRejectedValueOnce(new Error("locked"));
    const store = await openNativeDeviceStore({ wait });
    expect(store.durable).toBe(true);
    expect(createMMKV).toHaveBeenLastCalledWith(expect.objectContaining({ encryptionKey: "k".repeat(32) }));
    expect(wait.mock.calls).toEqual([[500], [1000]]);
    expect(reports).toEqual([]);

    // The app's own wait is a timer.
    vi.useFakeTimers();
    try {
      vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("locked"));
      const opening = openNativeDeviceStore();
      await vi.advanceTimersByTimeAsync(500);
      expect((await opening).durable).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a key gone while its file is still there: the unreadable file is deleted on purpose and reported", async () => {
    files.set("uniwork-chat", new Map([["chat-send-outbox", "ciphertext"]]));
    const store = await openNativeDeviceStore({ wait });
    expect(store.durable).toBe(true);
    expect(store.getString("chat-send-outbox")).toBeUndefined();
    expect(reports).toEqual([{ message: "device_store_key_lost", tags: { source: "device-store", outcome: "file_deleted" } }]);
  });

  it("without a key or the native module, the launch runs on memory, and it is reported, not only logged", async () => {
    createMMKV.mockImplementationOnce(() => {
      throw new Error("no native module");
    });
    const store = await openNativeDeviceStore();
    store.set("a", "1");
    expect(store.getString("a")).toBe("1");
    expect(store.durable).toBe(false);

    vi.mocked(SecureStore.getItemAsync).mockRejectedValue("locked");
    try {
      expect((await openNativeDeviceStore({ wait })).durable).toBe(false);
    } finally {
      vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key: string) => keychain.get(key) ?? null);
    }
    expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1 + KEY_READ_ATTEMPTS);
    expect(breadcrumbs.filter((m) => m.includes("device store unavailable"))).toHaveLength(2);
    expect(reports).toEqual([
      { message: "no native module", tags: { source: "device-store", outcome: "memory" } },
      { message: "device_store_unavailable", tags: { source: "device-store", outcome: "memory" } },
    ]);
  });
});
