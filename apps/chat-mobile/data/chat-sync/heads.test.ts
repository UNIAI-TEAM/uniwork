import { beforeEach, describe, expect, it } from "vitest";
import { installDeviceStore, memoryDeviceStore, type DeviceStore } from "../storage/device-store";
import { chatSyncHeads, forgetChatSyncHeads } from "./heads";

let disk: DeviceStore;
beforeEach(() => {
  disk = memoryDeviceStore();
  installDeviceStore(async () => disk);
});

describe("chat sync heads", () => {
  it("keeps one head per person and workspace on the device", async () => {
    expect(await chatSyncHeads.get("u1", "w1")).toBeNull();
    await chatSyncHeads.set("u1", "w1", 42);
    await chatSyncHeads.set("u1", "w2", 7);
    expect(await chatSyncHeads.get("u1", "w1")).toBe(42);
    expect(await chatSyncHeads.get("u2", "w1")).toBeNull();
    expect(disk.getString("chat-sync/u1/w2")).toBe("7");
  });

  it("reads anything but a whole number as no head", async () => {
    for (const raw of ["", "abc", "-1", "1.5", "1e400", "99999999999999999999"]) {
      disk.set("chat-sync/u1/w1", raw);
      expect(await chatSyncHeads.get("u1", "w1")).toBeNull();
    }
  });

  it("sign-out forgets every head and nothing else", async () => {
    await chatSyncHeads.set("u1", "w1", 1);
    await chatSyncHeads.set("u2", "w9", 2);
    disk.set("chat-send-outbox", "{}");
    await forgetChatSyncHeads();
    expect(disk.keys()).toEqual(["chat-send-outbox"]);
  });
});
