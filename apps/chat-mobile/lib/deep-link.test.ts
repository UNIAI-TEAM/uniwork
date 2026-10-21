import { describe, expect, it } from "vitest";
import { deepLinkHref, inAppDmHref, incomingUrlAction, parseDeepLink, setPendingDeepLink, systemPathToRoute, takeInAppDm, takePendingDeepLink } from "./deep-link";

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

  it("reads the call a ringing push names (notification.ResourceURL, chat_room)", () => {
    expect(parseDeepLink(`${APP_URL}/acme/hq/chat?room=r1&call=c-1`, APP_URL, SCHEME)).toEqual({
      orgSlug: "acme",
      wsSlug: "hq",
      roomId: "r1",
      callId: "c-1",
    });
    expect(deepLinkHref({ orgSlug: "acme", wsSlug: "hq", roomId: "r1", callId: "c-1" })).toBe("/acme/hq/chat?room=r1&call=c-1");
  });

  // Audit (Security & privacy, deeplink-auto-answer): a link from a web page, a message or another app on the
  // phone must never pick up a ringing call. A URL can only make it ring; Answer reaches the app from the
  // notification's own PendingIntent (modules/unichat-calls › CallLaunchTokens), which no URL carries.
  it("never answers a call from a URL: answer=1, on a universal link or the scheme wrapper, only rings", () => {
    const ring = { orgSlug: "acme", wsSlug: "hq", roomId: "r1", callId: "c-1" };
    const answer = `${APP_URL}/acme/hq/chat?room=r1&call=c-1&answer=1`;
    expect(parseDeepLink(answer, APP_URL, SCHEME)).toEqual(ring);
    expect(parseDeepLink(`${SCHEME}://open?url=${encodeURIComponent(answer)}`, APP_URL, SCHEME)).toEqual(ring);
    expect(systemPathToRoute(answer, APP_URL, SCHEME)).toBe("/acme/hq/chat?room=r1&call=c-1");
    expect(incomingUrlAction(answer, { appUrl: APP_URL, scheme: SCHEME, signedIn: true, navigate: true })).toEqual({ kind: "open", href: "/acme/hq/chat?room=r1&call=c-1" });
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

describe("in-app DM (Contacts, room info)", () => {
  it("vouches for the one DM the app asked for, once and for a few seconds; a link's dm= is never vouched for", () => {
    expect(takeInAppDm("u2", 0)).toBe(false);
    expect(inAppDmHref({ orgSlug: "acme", wsSlug: "hq" }, "u2", 1_000)).toBe("/acme/hq/chat?dm=u2");
    expect(takeInAppDm("u2", 2_000)).toBe(true);
    expect(takeInAppDm("u2", 2_000)).toBe(false);
    // Another person's DM (an outside link landing meanwhile) spends the vouch without using it.
    inAppDmHref({ orgSlug: "acme", wsSlug: "hq" }, "u2", 1_000);
    expect(takeInAppDm("u9", 1_500)).toBe(false);
    expect(takeInAppDm("u2", 1_500)).toBe(false);
    // Stale: the tab never took it in time.
    inAppDmHref({ orgSlug: "acme", wsSlug: "hq" }, "u2", 1_000);
    expect(takeInAppDm("u2", 11_001)).toBe(false);
    // The real clock by default.
    inAppDmHref({ orgSlug: "acme", wsSlug: "hq" }, "u3");
    expect(takeInAppDm("u3")).toBe(true);
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

describe("incomingUrlAction", () => {
  const options = { appUrl: APP_URL, scheme: SCHEME, signedIn: true, navigate: true };
  const chatUrl = `${APP_URL}/acme/hq/chat?room=r1`;

  it("completes the sign-in on the PKCE callback, whoever is signed in", () => {
    const callback = `${SCHEME}://auth/callback?code=c&state=s`;
    expect(incomingUrlAction(callback, { ...options, signedIn: false })).toEqual({ kind: "callback" });
  });

  it("keeps a chat link until someone is signed in", () => {
    expect(incomingUrlAction(chatUrl, { ...options, signedIn: false })).toEqual({ kind: "keep", link: { orgSlug: "acme", wsSlug: "hq", roomId: "r1" } });
  });

  it("opens a notification's link, and leaves a Linking URL to +native-intent", () => {
    expect(incomingUrlAction(chatUrl, options)).toEqual({ kind: "open", href: "/acme/hq/chat?room=r1" });
    expect(incomingUrlAction(chatUrl, { ...options, navigate: false })).toEqual({ kind: "ignore" });
  });

  it("ignores a URL that is no chat link", () => {
    expect(incomingUrlAction("https://elsewhere.example/x", options)).toEqual({ kind: "ignore" });
  });
});
