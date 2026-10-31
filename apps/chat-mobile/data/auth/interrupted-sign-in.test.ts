import { beforeEach, describe, expect, it } from "vitest";
import { installDeviceStore, memoryDeviceStore, openDeviceStore, type DeviceStore } from "../storage/device-store";
import { INTERRUPTED_NOTICE_MS, clearChoiceMark, markChoiceOpen, takeInterruptedChoice } from "./interrupted-sign-in";

const NOW = Date.parse("2026-10-28T09:00:00Z");
let store: DeviceStore;

beforeEach(() => {
  store = memoryDeviceStore();
  installDeviceStore(async () => store);
});

describe("a choice screen the app was closed on", () => {
  it("keeps the provider and the time only, and is told once", async () => {
    await markChoiceOpen("apple", NOW);
    expect(store.keys()).toEqual(["sign-in/choice-open"]);
    expect(store.getString("sign-in/choice-open")).toBe(JSON.stringify({ provider: "apple", at: NOW }));
    expect(await takeInterruptedChoice(NOW + 60_000)).toBe("apple");
    expect(await takeInterruptedChoice(NOW + 60_000)).toBeNull();
  });

  it("says nothing once the choice was spent, declined or replaced", async () => {
    await markChoiceOpen("google", NOW);
    await clearChoiceMark();
    expect(await takeInterruptedChoice(NOW)).toBeNull();
  });

  it("forgets a mark too old to mention, from the future, or not its own shape", async () => {
    for (const raw of [
      JSON.stringify({ provider: "apple", at: NOW - INTERRUPTED_NOTICE_MS - 1 }),
      JSON.stringify({ provider: "apple", at: NOW + 1 }),
      JSON.stringify({ provider: "github", at: NOW }),
      JSON.stringify({ provider: "apple", at: "now" }),
      JSON.stringify(null),
      "not json",
    ]) {
      (await openDeviceStore()).set("sign-in/choice-open", raw);
      expect(await takeInterruptedChoice(NOW)).toBeNull();
      expect(store.keys()).toEqual([]);
    }
  });
});
