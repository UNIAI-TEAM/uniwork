import { describe, expect, it } from "vitest";
import { installDeviceStore, memoryDeviceStore } from "../storage/device-store";
import { NUDGE_DISMISSED_KEY, dismissNudge, readDismissedNudge } from "./update-nudge";

describe("the dismissed nudge", () => {
  it("is nothing until one is dismissed, then that version, on the store it is given or the device's", async () => {
    const store = memoryDeviceStore();
    expect(await readDismissedNudge(async () => store)).toBeNull();
    await dismissNudge("0.3.2", async () => store);
    expect(store.getString(NUDGE_DISMISSED_KEY)).toBe("0.3.2");
    expect(await readDismissedNudge(async () => store)).toBe("0.3.2");
    const device = memoryDeviceStore();
    installDeviceStore(async () => device);
    await dismissNudge("0.4.0");
    expect(await readDismissedNudge()).toBe("0.4.0");
  });
});
