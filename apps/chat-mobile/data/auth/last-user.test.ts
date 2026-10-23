import { beforeEach, describe, expect, it, vi } from "vitest";

const keychain = vi.hoisted(() => ({ value: null as string | null, failRead: false }));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: vi.fn(async () => {
    if (keychain.failRead) throw new Error("locked");
    return keychain.value;
  }),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    keychain.value = value;
  }),
  deleteItemAsync: vi.fn(async () => {
    keychain.value = null;
  }),
}));

import * as SecureStore from "expo-secure-store";
import { currentSessionEpoch, invalidateSessionEpoch } from "../session-epoch";
import { forgetLastUser, readLastUser, rememberUser } from "./last-user";

const user = { id: "u1", email: "a@b.c", display_name: "An", onboarded_at: null, email_verified_at: null, onboarding_questionnaire: {}, locale: "vi" };

beforeEach(() => {
  keychain.value = null;
  keychain.failRead = false;
});

describe("last signed-in user", () => {
  it("is kept in the Keychain beside the session and read back for the next cold start", async () => {
    expect(await readLastUser()).toBeNull();
    await rememberUser(user, currentSessionEpoch());
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("uniwork_chat_last_user", JSON.stringify(user), { keychainAccessible: "afterFirstUnlockThisDeviceOnly" });
    expect(await readLastUser()).toMatchObject({ id: "u1", display_name: "An" });
    await forgetLastUser();
    expect(await readLastUser()).toBeNull();
  });

  it("a /me that lands after the sign-out does not bring the person back", async () => {
    const epoch = currentSessionEpoch();
    invalidateSessionEpoch();
    await rememberUser(user, epoch);
    expect(keychain.value).toBeNull();
  });

  it("a locked Keychain, garbage or a copy without an id reads as none; a failed write is not an error", async () => {
    keychain.failRead = true;
    expect(await readLastUser()).toBeNull();
    keychain.failRead = false;
    keychain.value = "{not json";
    expect(await readLastUser()).toBeNull();
    keychain.value = JSON.stringify({ email: "a@b.c" });
    expect(await readLastUser()).toBeNull();
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("full"));
    await expect(rememberUser(user, currentSessionEpoch())).resolves.toBeUndefined();
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error("locked"));
    await expect(forgetLastUser()).resolves.toBeUndefined();
  });
});
