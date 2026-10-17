import { describe, expect, it } from "vitest";
import { deepLinkHref, parseDeepLink, setPendingDeepLink, systemPathToRoute, takePendingDeepLink } from "./deep-link";

const APP_URL = "https://app.uniworkos.com";
const SCHEME = "uniworkchat";

describe("parseDeepLink", () => {
  it("reads the room, message and dm params of a chat universal link", () => {
    expect(parseDeepLink(`${APP_URL}/acme/hq/chat?room=r1&message=m1`, APP_URL, SCHEME)).toEqual({
      orgSlug: "acme",
      wsSlug: "hq",
      roomId: "r1",
      messageId: "m1",
    });
    expect(parseDeepLink(`${APP_URL}/acme/hq/chat?dm=u2`, APP_URL, SCHEME)).toEqual({
      orgSlug: "acme",
      wsSlug: "hq",
      dmUserId: "u2",
    });
    expect(parseDeepLink(`${APP_URL}/acme/hq/chat`, APP_URL, SCHEME)).toEqual({ orgSlug: "acme", wsSlug: "hq" });
  });

  it("unwraps <scheme>://open?url=<percent-encoded path>, scheme case-insensitively", () => {
    const path = encodeURIComponent("/acme/hq/chat?room=r1");
    expect(parseDeepLink(`${SCHEME}://open?url=${path}`, APP_URL, SCHEME)).toEqual({
      orgSlug: "acme",
      wsSlug: "hq",
      roomId: "r1",
    });
    expect(parseDeepLink(`UNIWORKCHAT://open?url=${path}`, APP_URL, SCHEME)).not.toBeNull();
    // an absolute target is held to the same origin check
    expect(parseDeepLink(`${SCHEME}://open?url=${encodeURIComponent(`${APP_URL}/acme/hq/chat`)}`, APP_URL, SCHEME)).toEqual({
      orgSlug: "acme",
      wsSlug: "hq",
    });
  });

  it.each([
    ["another origin", "https://evil.example/acme/hq/chat?room=r1"],
    ["another scheme", "otherapp://open?url=%2Facme%2Fhq%2Fchat"],
    ["the auth callback", `${SCHEME}://auth/callback?code=x&state=y`],
    ["open without url", `${SCHEME}://open`],
    ["open to another origin", `${SCHEME}://open?url=${encodeURIComponent("https://evil.example/acme/hq/chat")}`],
    ["a non-chat page", `${APP_URL}/acme/hq/tasks`],
    ["too few segments", `${APP_URL}/acme/chat`],
    ["not a url", "nope"],
  ])("returns null for %s", (_, url) => {
    expect(parseDeepLink(url, APP_URL, SCHEME)).toBeNull();
  });
});

describe("deepLinkHref", () => {
  it("rebuilds the in-app route with only the params present", () => {
    expect(deepLinkHref({ orgSlug: "acme", wsSlug: "hq" })).toBe("/acme/hq/chat");
    expect(deepLinkHref({ orgSlug: "acme", wsSlug: "hq", roomId: "r 1", messageId: "m1" })).toBe(
      "/acme/hq/chat?room=r+1&message=m1",
    );
    expect(deepLinkHref({ orgSlug: "acme", wsSlug: "hq", dmUserId: "u2" })).toBe("/acme/hq/chat?dm=u2");
  });
});

describe("pending deep link", () => {
  it("hands the link out once", () => {
    expect(takePendingDeepLink()).toBeNull();
    const link = { orgSlug: "acme", wsSlug: "hq" };
    setPendingDeepLink(link);
    expect(takePendingDeepLink()).toBe(link);
    expect(takePendingDeepLink()).toBeNull();
  });
});

describe("systemPathToRoute (+native-intent)", () => {
  it("maps a chat link, wrapped or universal, onto its route", () => {
    expect(systemPathToRoute(`${APP_URL}/acme/hq/chat?room=r1`, APP_URL, SCHEME)).toBe("/acme/hq/chat?room=r1");
    const wrapped = `${SCHEME}://open?url=${encodeURIComponent("/acme/hq/chat?dm=u2")}`;
    expect(systemPathToRoute(wrapped, APP_URL, SCHEME)).toBe("/acme/hq/chat?dm=u2");
  });

  it("sends the PKCE callback to the login screen, which the Linking listener completes", () => {
    expect(systemPathToRoute(`${SCHEME}://auth/callback?code=c&state=s`, APP_URL, SCHEME)).toBe("/login");
  });

  it("leaves any other URL to expo-router", () => {
    expect(systemPathToRoute(`${APP_URL}/settings`, APP_URL, SCHEME)).toBe(`${APP_URL}/settings`);
    expect(systemPathToRoute("/select-workspace", APP_URL, SCHEME)).toBe("/select-workspace");
  });
});
