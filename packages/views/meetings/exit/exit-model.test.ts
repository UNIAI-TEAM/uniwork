import { describe, expect, it } from "vitest";
import { canRejoin, participantIdFromToken } from "./exit-model";

const b64url = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (claims: object) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.sig`;

describe("participantIdFromToken", () => {
  it("reads the participant id out of the LiveKit identity", () => {
    expect(participantIdFromToken(token({ sub: "uw_participant_01ABC" }))).toBe("01ABC");
  });

  it("is null for another identity, a broken token or none", () => {
    expect(participantIdFromToken(token({ sub: "uw_agent_scribe" }))).toBeNull();
    expect(participantIdFromToken("not-a-jwt")).toBeNull();
    expect(participantIdFromToken("a.%%%.c")).toBeNull();
    expect(participantIdFromToken(undefined)).toBeNull();
  });
});

describe("canRejoin", () => {
  it("lets a viewer back after leaving or handing over, never after the end or a removal", () => {
    const media = { audio: true, video: false };
    expect(canRejoin({ kind: "left", media })).toBe(true);
    expect(canRejoin({ kind: "handedOver", media, toUserId: "u", toName: "Lan" })).toBe(true);
    expect(canRejoin({ kind: "ended", at: "2026-10-27T09:21:00Z" })).toBe(false);
    expect(canRejoin({ kind: "removed", at: "2026-10-27T08:52:00Z" })).toBe(false);
  });
});

describe("elapsedClock", () => {
  it("reads mm:ss under an hour and h:mm:ss after, never negative", async () => {
    const { elapsedClock } = await import("./exit-presence-card");
    const start = "2026-10-27T08:40:00Z";
    expect(elapsedClock(start, Date.parse("2026-10-27T09:04:10Z"))).toBe("24:10");
    expect(elapsedClock(start, Date.parse("2026-10-27T10:05:03Z"))).toBe("1:25:03");
    expect(elapsedClock(start, Date.parse("2026-10-27T08:39:00Z"))).toBe("00:00");
    expect(elapsedClock("not a date", Date.now())).toBeNull();
  });
});
