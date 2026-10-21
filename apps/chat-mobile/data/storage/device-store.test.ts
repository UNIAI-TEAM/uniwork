import { describe, expect, it, vi } from "vitest";
import { deviceStateStorage, installDeviceStore, memoryDeviceStore, openDeviceStore } from "./device-store";

describe("device store", () => {
  it("opens once per launch and hands every caller the same store; memory until one is installed", async () => {
    const memory = memoryDeviceStore();
    memory.set("k", "v");
    expect(memory.getString("k")).toBe("v");
    expect(memory.remove("k")).toBe(true);
    expect(memory.getString("k")).toBeUndefined();
    // Nothing outlives the launch: the outbox on it is not durable.
    expect(memory.durable).toBe(false);

    const opener = vi.fn(async () => memory);
    installDeviceStore(opener);
    const [a, b] = await Promise.all([openDeviceStore(), openDeviceStore()]);
    expect(a).toBe(memory);
    expect(b).toBe(memory);
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it("is zustand's persist storage", async () => {
    installDeviceStore(async () => memoryDeviceStore());
    expect(await deviceStateStorage.getItem("x")).toBeNull();
    await deviceStateStorage.setItem("x", "1");
    expect(await deviceStateStorage.getItem("x")).toBe("1");
    await deviceStateStorage.removeItem("x");
    expect(await deviceStateStorage.getItem("x")).toBeNull();
  });
});
