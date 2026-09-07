import { beforeEach, describe, expect, it } from "vitest";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import {
  clearCachedJoinDecision,
  inviteStorageKey,
  readCachedJoinDecision,
  readInviteJoinBody,
  writeCachedJoinDecision,
} from "./meeting-invite-session";

const LINK_ID = "link-123";

describe("meeting-invite-session", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("builds namespaced storage keys", () => {
    expect(inviteStorageKey(LINK_ID, "secret")).toBe("uw.meeting-invite.link-123.secret");
    expect(inviteStorageKey(LINK_ID, "joinDecision")).toBe(
      "uw.meeting-invite.link-123.joinDecision",
    );
  });

  it("returns undefined when no secret is stored", () => {
    expect(readInviteJoinBody(LINK_ID)).toBeUndefined();
  });

  it("returns undefined when the stored secret is blank", () => {
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "secret"), "");
    expect(readInviteJoinBody(LINK_ID)).toBeUndefined();
  });

  it("omits display_name when none is stored", () => {
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "secret"), "s3cr3t");
    expect(readInviteJoinBody(LINK_ID)).toEqual({
      invite_link_id: LINK_ID,
      secret: "s3cr3t",
      display_name: undefined,
    });
  });

  it("omits display_name when the stored name is blank", () => {
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "secret"), "s3cr3t");
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "displayName"), "");
    expect(readInviteJoinBody(LINK_ID)?.display_name).toBeUndefined();
  });

  it("includes display_name when a non-blank name is stored", () => {
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "secret"), "s3cr3t");
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "displayName"), "Guest One");
    expect(readInviteJoinBody(LINK_ID)).toEqual({
      invite_link_id: LINK_ID,
      secret: "s3cr3t",
      display_name: "Guest One",
    });
  });

  it("returns undefined when no join decision is cached", () => {
    expect(readCachedJoinDecision(LINK_ID)).toBeUndefined();
  });

  it("returns undefined for blank or corrupted cached decisions", () => {
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "joinDecision"), "");
    expect(readCachedJoinDecision(LINK_ID)).toBeUndefined();
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "joinDecision"), "{not-json");
    expect(readCachedJoinDecision(LINK_ID)).toBeUndefined();
  });

  it("round-trips cached join decisions through write and clear", () => {
    const decision: JoinDecision = { decision: "JOIN" };
    writeCachedJoinDecision(LINK_ID, decision);
    expect(readCachedJoinDecision(LINK_ID)).toEqual(decision);
    clearCachedJoinDecision(LINK_ID);
    expect(readCachedJoinDecision(LINK_ID)).toBeUndefined();
  });
});
