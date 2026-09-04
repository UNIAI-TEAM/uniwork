import { beforeEach, describe, expect, it } from "vitest";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import {
  clearCachedJoinDecision,
  inviteStorageKey,
  readCachedJoinDecision,
  readInviteJoinBody,
  writeCachedJoinDecision,
} from "./meeting-invite-session";

describe("meeting-invite-session", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("builds stable storage keys per link and suffix", () => {
    expect(inviteStorageKey("link-1", "secret")).toBe("uw.meeting-invite.link-1.secret");
  });

  it("reads join body when secret is stored", () => {
    sessionStorage.setItem(inviteStorageKey("link-1", "secret"), "abc");
    sessionStorage.setItem(inviteStorageKey("link-1", "displayName"), "Guest");
    expect(readInviteJoinBody("link-1")).toEqual({
      invite_link_id: "link-1",
      secret: "abc",
      display_name: "Guest",
    });
  });

  it("returns undefined when secret is missing or display name is blank", () => {
    expect(readInviteJoinBody("link-1")).toBeUndefined();
    sessionStorage.setItem(inviteStorageKey("link-1", "secret"), "abc");
    expect(readInviteJoinBody("link-1")).toEqual({
      invite_link_id: "link-1",
      secret: "abc",
      display_name: undefined,
    });
  });

  it("round-trips cached join decisions and clears them", () => {
    const decision = { decision: "ADMIT", participant_token: "tok" } as JoinDecision;
    writeCachedJoinDecision("link-1", decision);
    expect(readCachedJoinDecision("link-1")).toEqual(decision);
    clearCachedJoinDecision("link-1");
    expect(readCachedJoinDecision("link-1")).toBeUndefined();
  });

  it("ignores malformed cached join decisions", () => {
    sessionStorage.setItem(inviteStorageKey("link-1", "joinDecision"), "{not json");
    expect(readCachedJoinDecision("link-1")).toBeUndefined();
  });
});
