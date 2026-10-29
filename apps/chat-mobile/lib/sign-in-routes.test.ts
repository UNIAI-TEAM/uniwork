import { describe, expect, it } from "vitest";
import { afterSignInHref, isLinkMode, signInRoutes } from "./sign-in-routes";

describe("signInRoutes", () => {
  it("names each sign-in screen, link mode in the URL only when asked", () => {
    expect(signInRoutes.login()).toBe("/login");
    expect(signInRoutes.login({ link: true })).toBe("/login?link=1");
    expect(signInRoutes.secondFactor()).toBe("/mfa");
    expect(signInRoutes.secondFactor({ link: true })).toBe("/mfa?link=1");
    expect(signInRoutes).toMatchObject({ register: "/register", choice: "/continue", linkStep: "/link-sign-in", verifyEmail: "/verify-email" });
  });
});

describe("isLinkMode", () => {
  it("reads link=1 as a string or the first of several, and nothing else", () => {
    expect(isLinkMode("1")).toBe(true);
    expect(isLinkMode(["1", "0"])).toBe(true);
    expect(isLinkMode("true")).toBe(false);
    expect(isLinkMode(undefined)).toBe(false);
    expect(isLinkMode([])).toBe(false);
  });
});

describe("afterSignInHref", () => {
  it("goes to the link step only when the person asked to link and an identity still waits", () => {
    expect(afterSignInHref({ linkMode: true, choiceHeld: true })).toBe("/link-sign-in");
    expect(afterSignInHref({ linkMode: true, choiceHeld: false })).toBe("/");
    expect(afterSignInHref({ linkMode: false, choiceHeld: true })).toBe("/");
  });
});
