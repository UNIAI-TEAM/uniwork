import { beforeEach, describe, expect, it } from "vitest";
import { installDeviceStore, memoryDeviceStore } from "../storage/device-store";
import { hydrateReportedMessagesStore, useReportedMessagesStore } from "./reported-messages-store";

beforeEach(() => useReportedMessagesStore.getState().clearAll());

describe("reported messages store", () => {
  it("hides a reported message, shows it again for this run on request, and hides it again on a new report", () => {
    const store = useReportedMessagesStore.getState();
    store.hide("m1", 5);
    expect(useReportedMessagesStore.getState().reported).toEqual({ m1: 5 });
    store.reveal("m1");
    expect(useReportedMessagesStore.getState().revealed).toEqual({ m1: true });
    store.hide("m1", 6);
    expect(useReportedMessagesStore.getState()).toMatchObject({ reported: { m1: 6 }, revealed: {} });
    store.hide("m2");
    expect(Object.keys(useReportedMessagesStore.getState().reported)).toEqual(["m1", "m2"]);
  });

  it("writes nothing before the boot read, then keeps the reports across a restart but not what was revealed", async () => {
    const disk = memoryDeviceStore();
    installDeviceStore(async () => disk);
    useReportedMessagesStore.getState().hide("early", 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disk.getString("chat-reported-messages")).toBeUndefined();
    disk.set("chat-reported-messages", JSON.stringify({ state: { reported: { kept: 2, broken: "x" } }, version: 1 }));
    await hydrateReportedMessagesStore();
    expect(useReportedMessagesStore.getState().reported).toEqual({ kept: 2, early: 1 });
    useReportedMessagesStore.getState().reveal("kept");
    useReportedMessagesStore.getState().hide("late", 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(disk.getString("chat-reported-messages") ?? "{}").state).toEqual({ reported: { kept: 2, early: 1, late: 3 } });
  });

  it("reads a state an older or newer build wrote through the same schema", () => {
    const { migrate } = useReportedMessagesStore.persist.getOptions();
    expect(migrate?.({ reported: { a: 1, b: null } }, 0)).toEqual({ reported: { a: 1 } });
    expect(migrate?.(null, 2)).toEqual({ reported: {} });
  });
});
