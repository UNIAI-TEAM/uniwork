import { describe, expect, it } from "vitest";
import { deepLinkKey, planDeepLink } from "./deep-link-target";

describe("deepLinkKey", () => {
  it("is empty without params and tells two links apart", () => {
    expect(deepLinkKey({})).toBe("");
    expect(deepLinkKey({ room: "r1" })).toBe("r1|||");
    expect(deepLinkKey({ room: "r1", message: "m1" })).not.toBe(deepLinkKey({ room: "r1" }));
    expect(deepLinkKey({ room: "r1", call: "c1" })).toBe("r1|||c1");
  });
});

describe("planDeepLink", () => {
  it("opens a room, at a message when one is named", () => {
    expect(planDeepLink({ room: "r1" }, true)).toEqual({ kind: "room", roomId: "r1" });
    expect(planDeepLink({ room: "r1", message: "m1" }, true)).toEqual({ kind: "room", roomId: "r1", messageId: "m1" });
  });

  it("opens a DM by person", () => {
    expect(planDeepLink({ dm: "u2" }, true)).toEqual({ kind: "dm", userId: "u2" });
  });

  it("rings for a call's link, whatever else the link says: a URL never answers", () => {
    expect(planDeepLink({ room: "r1", call: "c1" }, true)).toEqual({ kind: "ring", roomId: "r1", callId: "c1" });
    expect(planDeepLink({ room: "r1", call: "c1", answer: "1" } as never, true)).toEqual({ kind: "ring", roomId: "r1", callId: "c1" });
  });

  it("with the calls switch off, a call's push opens its room instead", () => {
    expect(planDeepLink({ room: "r1", call: "c1" }, false)).toEqual({ kind: "calls-off", roomId: "r1", callId: "c1" });
  });

  it("does nothing without a room or a person (a call alone names no room)", () => {
    expect(planDeepLink({}, true)).toEqual({ kind: "none" });
    expect(planDeepLink({ call: "c1", message: "m1" }, true)).toEqual({ kind: "none" });
  });
});
