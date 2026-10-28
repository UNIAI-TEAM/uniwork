import { ParticipantKind } from "livekit-client";
import { describe, expect, it } from "vitest";
import {
  humanParticipants,
  inMeeting,
  decodeSignal,
  encodeSignal,
  expireReactions,
  forgetIdentity,
  initialSignalsState,
  REACTION_TTL_MS,
  guestIdentities,
  muteRequesterIdentities,
  participantRole,
  reduceSignal,
  shouldHonorMuteRequest,
  micLockedNow,
} from "./meeting-signals";

describe("meeting signals", () => {
  it("round-trips every signal kind and rejects garbage", () => {
    expect(decodeSignal(encodeSignal({ kind: "hand", value: true }))).toEqual({ kind: "hand", value: true });
    expect(decodeSignal(encodeSignal({ kind: "reaction", value: "👍" }))).toEqual({ kind: "reaction", value: "👍" });
    expect(decodeSignal(encodeSignal({ kind: "mute_request", target: "p1" }))).toEqual({
      kind: "mute_request",
      target: "p1",
    });
    expect(decodeSignal(encodeSignal({ kind: "mute_all" }))).toEqual({ kind: "mute_all" });
    expect(decodeSignal(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodeSignal(new TextEncoder().encode('{"kind":"hand","value":"yes"}'))).toBeNull();
    expect(decodeSignal(new TextEncoder().encode('{"kind":"reaction","value":"' + "x".repeat(20) + '"}'))).toBeNull();
    expect(decodeSignal(new TextEncoder().encode("null"))).toBeNull();
    expect(decodeSignal(new TextEncoder().encode('{"kind":"mute_request","target":1}'))).toBeNull();
    expect(decodeSignal(new TextEncoder().encode('{"kind":"unknown"}'))).toBeNull();
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

  it("drops stale reactions when a new one arrives", () => {
    let s = reduceSignal(initialSignalsState, "a", { kind: "reaction", value: "👍" }, 1000);
    s = reduceSignal(s, "b", { kind: "reaction", value: "❤️" }, 1000 + REACTION_TTL_MS + 1);
    expect(s.reactions).toHaveLength(1);
    expect(s.reactions[0]?.value).toBe("❤️");
  });

  it("mute_request does not change shared state", () => {
    expect(reduceSignal(initialSignalsState, "host", { kind: "mute_request", target: "a" }, 0)).toBe(
      initialSignalsState,
    );
  });

  it("maps host participants to LiveKit identities and ignores others", () => {
    const host = { id: "p-host", user_id: "u-host" };
    const markedHost = { id: "p-marked", user_id: "u-other", is_host: true };
    const member = { id: "p-member", user_id: "u-member" };
    expect(muteRequesterIdentities("u-host", [host, markedHost, member])).toEqual([
      "uw_participant_p-host",
      "uw_participant_p-marked",
    ]);
    expect(shouldHonorMuteRequest("uw_participant_p-host", ["uw_participant_p-host"])).toBe(true);
    expect(shouldHonorMuteRequest("uw_participant_p-guest", ["uw_participant_p-host"])).toBe(false);
  });

  // UNI-890: a guest never reads the meeting, so it has no host_user_id. The host is the seat the list marks,
  // and a guest's own row (no user_id) is never taken for the host.
  it("on a guest's client finds the host by is_host, never by a missing user id", () => {
    const host = { id: "p-host", user_id: "u-host", is_host: true };
    const guest = { id: "p-guest" };
    expect(muteRequesterIdentities(undefined, [host, guest])).toEqual(["uw_participant_p-host"]);
    expect(muteRequesterIdentities(undefined, [{ id: "p-host", user_id: "u-host" }, guest])).toEqual([]);
  });
});

describe("participant roles", () => {
  const api = [
    { id: "p1", principal_type: "USER", user_id: "u1", role: "HOST", status: "ACTIVE" },
    { id: "p2", principal_type: "GUEST", guest_id: "g1", role: "PARTICIPANT", status: "ACTIVE" },
    { id: "p3", principal_type: "guest", guest_id: "g2", role: "PARTICIPANT", status: "ACTIVE" },
  ];

  it("maps guest participants to their LiveKit identities", () => {
    expect([...guestIdentities(api)].sort()).toEqual(["uw_participant_p2", "uw_participant_p3"]);
  });

  it("names agents from the LiveKit participant kind and guests from the meeting record", () => {
    const guests = guestIdentities(api);
    expect(participantRole({ identity: "agent-stt", isAgent: true }, guests)).toBe("agent");
    expect(participantRole({ identity: "uw_participant_p2", isAgent: false }, guests)).toBe("guest");
    expect(participantRole({ identity: "uw_participant_p1", isAgent: false }, guests)).toBeNull();
  });

  it("names a phone caller from the SIP participant kind", () => {
    expect(participantRole({ identity: "sip_c15a31c71649a522", kind: ParticipantKind.SIP }, guestIdentities(api))).toBe("phone");
  });
});

describe("humanParticipants", () => {
  it("leaves out the scribe and every phone caller the host has not admitted", () => {
    const people = [
      { identity: "uw_participant_p1" },
      { identity: "uw_agent_scribe", isAgent: true },
      // Before the server's hold attribute lands, a caller carries none.
      { identity: "sip_new", kind: ParticipantKind.SIP },
      { identity: "sip_waiting", kind: ParticipantKind.SIP, attributes: { "uw.dial_in": "waiting" } },
      { identity: "sip_in", kind: ParticipantKind.SIP, attributes: { "uw.dial_in": "admitted" } },
    ];
    expect(humanParticipants(people).map((p) => p.identity)).toEqual(["uw_participant_p1", "sip_in"]);
    expect(people.map(inMeeting)).toEqual([true, false, false, false, true]);
  });
});

describe("micLockedNow", () => {
  it("reads the host's lock from publish sources that leave the mic out", () => {
    expect(micLockedNow({ permissions: { canPublishSources: [1, 3, 4] } })).toBe(true);
    expect(micLockedNow({ permissions: { canPublishSources: [] } })).toBe(false);
    expect(micLockedNow({ permissions: { canPublishSources: [1, 2] } })).toBe(false);
    expect(micLockedNow({})).toBe(false);
  });

  it("does not call an audience member's mic locked: nobody could unlock it", () => {
    expect(micLockedNow({ permissions: { canPublishSources: [] } })).toBe(false);
  });
});
