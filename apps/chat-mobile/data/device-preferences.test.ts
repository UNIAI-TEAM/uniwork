import { beforeEach, describe, expect, it, vi } from "vitest";

const secure = vi.hoisted(() => ({
  AFTER_FIRST_UNLOCK: 0,
  getItemAsync: vi.fn<(key: string, options?: unknown) => Promise<string | null>>(),
  setItemAsync: vi.fn<(key: string, value: string, options?: unknown) => Promise<void>>(),
}));
vi.mock("expo-secure-store", () => secure);

import { readDevicePreference, writeDevicePreference } from "./device-preferences";

beforeEach(() => {
  secure.getItemAsync.mockReset();
  secure.setItemAsync.mockReset();
});

describe("device preferences", () => {
  it("reads and writes each choice under its key, readable after the first unlock", async () => {
    secure.getItemAsync.mockResolvedValue("dark");
    await expect(readDevicePreference("theme")).resolves.toBe("dark");
    expect(secure.getItemAsync).toHaveBeenCalledWith("theme-preference", { keychainAccessible: 0 });
    secure.setItemAsync.mockResolvedValue(undefined);
    await writeDevicePreference("locale", "en");
    expect(secure.setItemAsync).toHaveBeenCalledWith("locale_preference", "en", { keychainAccessible: 0 });
    await writeDevicePreference("privacy", "{}");
    expect(secure.setItemAsync).toHaveBeenCalledWith("privacy_preference", "{}", { keychainAccessible: 0 });
  });

  it("writes one at a time, and a failed write neither stalls the next nor hides its own failure", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    secure.setItemAsync.mockImplementationOnce(async (_key, value) => {
      await new Promise<void>((resolve) => (release = resolve));
      order.push(value);
      throw new Error("keychain");
    });
    secure.setItemAsync.mockImplementationOnce(async (_key, value) => void order.push(value));
    const first = writeDevicePreference("theme", "dark");
    const second = writeDevicePreference("theme", "light");
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await expect(first).rejects.toThrow("keychain");
    await second;
    expect(order).toEqual(["dark", "light"]);
  });
});
