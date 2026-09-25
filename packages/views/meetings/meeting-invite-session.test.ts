import { beforeEach, describe, expect, it, vi } from "vitest";
import { paths } from "@uniwork/core/paths";
import type { JoinDecision } from "@uniwork/core/types/meeting";
import {
  clearCachedJoinDecision,
  inviteStorageKey,
  leaveMeetingInvite,
  readCachedJoinDecision,
  readInviteJoinBody,
  writeCachedJoinDecision,
  writeInviteDisplayName,
  writeInvitePreJoinChoice,
  readInvitePreJoinChoice,
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

  it("persists display name via writeInviteDisplayName", () => {
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "secret"), "abc");
    writeInviteDisplayName(LINK_ID, "  Guest Name  ");
    expect(sessionStorage.getItem(inviteStorageKey(LINK_ID, "displayName"))).toBe("Guest Name");
    expect(readInviteJoinBody(LINK_ID)).toEqual({
      invite_link_id: LINK_ID,
      secret: "abc",
      display_name: "Guest Name",
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

  it("persists guest prejoin media choices", () => {
    expect(readInvitePreJoinChoice(LINK_ID)).toBeUndefined();
    writeInvitePreJoinChoice(LINK_ID, { audio: true, video: false, videoDeviceId: "cam-1" });
    expect(readInvitePreJoinChoice(LINK_ID)).toEqual({
      audio: true,
      video: false,
      audioDeviceId: undefined,
      videoDeviceId: "cam-1",
    });
    sessionStorage.setItem(inviteStorageKey(LINK_ID, "preJoinChoice"), "{not-json");
    expect(readInvitePreJoinChoice(LINK_ID)).toBeUndefined();
  });
});

describe("leaveMeetingInvite", () => {
  beforeEach(() => sessionStorage.clear());

  it("forgets the admitted decision and replaces the room entry", () => {
    writeCachedJoinDecision(LINK_ID, { decision: "ADMIT", participant_token: "tok" } as JoinDecision);
    const nav = { replace: vi.fn() };

    leaveMeetingInvite(nav, LINK_ID);

    expect(readCachedJoinDecision(LINK_ID)).toBeUndefined();
    expect(nav.replace).toHaveBeenCalledWith(`${paths.meetingInvite(LINK_ID)}?reason=left_room`);
  });
});
