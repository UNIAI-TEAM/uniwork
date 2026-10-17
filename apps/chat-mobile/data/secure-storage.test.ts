import { beforeEach, describe, expect, it, vi } from "vitest";

// The real module is used: its serialization is the mechanism under test.
// Only expo-secure-store underneath is faked, with hold/release so a test can
// pin an interleaving instead of guessing at microtask counts.
const keychain = vi.hoisted(() => ({
  value: null as string | null,
  holdClear: false,
  releaseClear: null as null | (() => void),
  log: [] as string[],
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => keychain.value),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    keychain.log.push(`set:${JSON.parse(value).refresh_token}`);
    keychain.value = value;
  }),
  deleteItemAsync: vi.fn(async () => {
    if (keychain.holdClear) {
      await new Promise<void>((resolve) => {
        keychain.releaseClear = resolve;
      });
    }
    keychain.log.push("clear");
    keychain.value = null;
  }),
}));

import * as SecureStore from "expo-secure-store";
import { secureSessionStorage, type StoredSession } from "./secure-storage";
import { currentSessionEpoch, invalidateSessionEpoch } from "./session-epoch";

const session = (refresh_token: string): StoredSession => ({
  access_token: `at_${refresh_token}`,
  refresh_token,
  device_session_id: "dev_1",
  deployment_id: "default",
  expires_at: 1_000,
  refresh_expires_at: 2_000,
});

beforeEach(() => {
  keychain.value = null;
  keychain.holdClear = false;
  keychain.releaseClear = null;
  keychain.log = [];
  vi.clearAllMocks();
});

describe("secure session storage", () => {
  it("stores the whole session as JSON under one key and reads it back", async () => {
    expect(await secureSessionStorage.load()).toBeNull();
    expect(await secureSessionStorage.commit(session("rt_1"), { epoch: currentSessionEpoch() })).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("uniwork_chat_session", JSON.stringify(session("rt_1")));
    expect(await secureSessionStorage.load()).toEqual(session("rt_1"));
    await secureSessionStorage.clear();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("uniwork_chat_session");
    expect(await secureSessionStorage.load()).toBeNull();
  });

  it.each([
    ["garbage", "{not json"],
    ["an array", "[]"],
    ["a missing field", JSON.stringify({ ...session("rt"), refresh_token: undefined })],
    ["a mistyped field", JSON.stringify({ ...session("rt"), expires_at: "soon" })],
    ["an empty token", JSON.stringify({ ...session("rt"), access_token: "" })],
  ])("reads %s as no session", async (_label, raw) => {
    keychain.value = raw;
    expect(await secureSessionStorage.load()).toBeNull();
  });

  it("refuses a commit once the epoch moved, even when its write is the last to be queued", async () => {
    const epoch = currentSessionEpoch();
    await secureSessionStorage.commit(session("rt_1"), { epoch });
    // logout begins: the epoch moves synchronously, the delete is left in flight
    keychain.holdClear = true;
    invalidateSessionEpoch();
    const logout = secureSessionStorage.clear();
    const stale = secureSessionStorage.commit(session("rt_2"), { epoch, previousRefreshToken: "rt_1" });
    await vi.waitFor(() => expect(keychain.releaseClear).not.toBeNull());
    keychain.releaseClear?.();
    await Promise.all([logout, stale]);
    expect(await stale).toBe(false);
    expect(keychain.log).toEqual(["set:rt_1", "clear"]);
    expect(await secureSessionStorage.load()).toBeNull();
  });

  it("refuses a rotation whose previous refresh token is no longer the stored one, and leaves a newer sign-in untouched", async () => {
    const epoch = currentSessionEpoch();
    await secureSessionStorage.commit(session("rt_new_account"), { epoch });
    expect(await secureSessionStorage.commit(session("rt_stale_v2"), { epoch, previousRefreshToken: "rt_old" })).toBe(false);
    expect(await secureSessionStorage.load()).toEqual(session("rt_new_account"));
    // nothing stored at all also fails the previous-token check
    await secureSessionStorage.clear();
    expect(await secureSessionStorage.commit(session("rt_x"), { epoch, previousRefreshToken: "rt_old" })).toBe(false);
  });

  it("applies a rotation whose previous token matches, in queue order", async () => {
    const epoch = currentSessionEpoch();
    await secureSessionStorage.commit(session("rt_1"), { epoch });
    const a = secureSessionStorage.commit(session("rt_2"), { epoch, previousRefreshToken: "rt_1" });
    const b = secureSessionStorage.commit(session("rt_3"), { epoch, previousRefreshToken: "rt_2" });
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(keychain.log).toEqual(["set:rt_1", "set:rt_2", "set:rt_3"]);
  });

  it("a failed write does not stall the queue", async () => {
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("keychain busy"));
    const epoch = currentSessionEpoch();
    await expect(secureSessionStorage.commit(session("rt_1"), { epoch })).rejects.toThrow("keychain busy");
    expect(await secureSessionStorage.commit(session("rt_2"), { epoch })).toBe(true);
  });
});
