import { afterEach, describe, expect, it } from "vitest";
import { membershipInviteSecretKey, readMembershipInviteSecret } from "./membership-invite-secret";

describe("readMembershipInviteSecret", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.location.hash = "";
  });

  it("reads the secret from the hash and caches it", () => {
    window.location.hash = "secret=s3cret";
    expect(readMembershipInviteSecret("link1")).toBe("s3cret");
    expect(sessionStorage.getItem(membershipInviteSecretKey("link1"))).toBe("s3cret");
  });

  it("falls back to sessionStorage when the hash is empty", () => {
    sessionStorage.setItem(membershipInviteSecretKey("link2"), "cached");
    window.location.hash = "";
    expect(readMembershipInviteSecret("link2")).toBe("cached");
  });
});
