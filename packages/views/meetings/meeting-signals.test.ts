import { describe, expect, it } from "vitest";
import {
  decodeSignal,
  encodeSignal,
  expireReactions,
  forgetIdentity,
  initialSignalsState,
  REACTION_TTL_MS,
  reduceSignal,
} from "./meeting-signals";

describe("meeting signals", () => {
  it("round-trips every signal kind and rejects garbage", () => {
    expect(decodeSignal(encodeSignal({ kind: "hand", value: true }))).toEqual({ kind: "hand", value: true });
    expect(decodeSignal(encodeSignal({ kind: "reaction", value: "👍" }))).toEqual({ kind: "reaction", value: "👍" });
    expect(decodeSignal(encodeSignal({ kind: "mute_request", target: "p1" }))).toEqual({
      kind: "mute_request",
      target: "p1",
    });
    expect(decodeSignal(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodeSignal(new TextEncoder().encode('{"kind":"hand","value":"yes"}'))).toBeNull();
    expect(decodeSignal(new TextEncoder().encode('{"kind":"reaction","value":"' + "x".repeat(20) + '"}'))).toBeNull();
  });

  it("keeps hands in raise order and lowers them", () => {
    let s = reduceSignal(initialSignalsState, "a", { kind: "hand", value: true }, 0);
    s = reduceSignal(s, "b", { kind: "hand", value: true }, 1);
    s = reduceSignal(s, "a", { kind: "hand", value: true }, 2); // re-raise does not jump the queue
    expect(s.hands).toEqual(["b", "a"]);
    s = reduceSignal(s, "b", { kind: "hand", value: false }, 3);
    expect(s.hands).toEqual(["a"]);
    expect(forgetIdentity(s, "a").hands).toEqual([]);
    expect(forgetIdentity(s, "zzz")).toBe(s);
  });

  it("expires reactions after the TTL", () => {
    let s = reduceSignal(initialSignalsState, "a", { kind: "reaction", value: "🎉" }, 1000);
    expect(s.reactions).toHaveLength(1);
    expect(expireReactions(s, 1000 + REACTION_TTL_MS - 1)).toBe(s);
    s = expireReactions(s, 1000 + REACTION_TTL_MS);
    expect(s.reactions).toHaveLength(0);
  });

  it("mute_request does not change shared state", () => {
    expect(reduceSignal(initialSignalsState, "host", { kind: "mute_request", target: "a" }, 0)).toBe(
      initialSignalsState,
    );
  });
});
