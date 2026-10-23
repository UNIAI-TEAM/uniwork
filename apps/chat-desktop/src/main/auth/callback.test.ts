import { describe, expect, it, vi } from "vitest";
import {
  createAuthCallbackRouter,
  extractAuthCallbackFromArgv,
  isAuthCallbackUrl,
  validateCallback,
} from "./callback";
import { LOGIN_ATTEMPT_TTL_MS, LoginAttemptStore } from "./pkce";

const SCHEME = "uniworkchat";
const REDIRECT = `${SCHEME}://auth/callback`;

function attempt(now = 1_000) {
  return new LoginAttemptStore().begin({
    clientId: "uniwork-chat-desktop",
    deploymentId: "default",
    redirectUri: REDIRECT,
    now,
  });
}

describe("callback validation", () => {
  const url = (state: string, extra = "") =>
    `${REDIRECT}?code=abc&state=${encodeURIComponent(state)}${extra}`;

  it("accepts the exact redirect with code + state", () => {
    const a = attempt();
    expect(validateCallback(url(a.state), a, 2_000)).toEqual({ ok: true, code: "abc" });
  });

  it.each([
    ["wrong scheme", (s: string) => `uniworkchat-dev://auth/callback?code=abc&state=${s}`, "wrong_redirect"],
    ["near-miss path", (s: string) => `${REDIRECT}/?code=abc&state=${s}`, "wrong_redirect"],
    ["case change", (s: string) => `UNIWORKCHAT://auth/callback?code=abc&state=${s}`, "wrong_redirect"],
    ["extra key", (s: string) => url(s, "&next=https://evil.example"), "unexpected_query"],
    ["duplicate code", (s: string) => url(s, "&code=other"), "duplicate_query"],
    ["fragment", (s: string) => `${url(s)}#frag`, "malformed"],
    ["missing code", (s: string) => `${REDIRECT}?state=${s}`, "missing_param"],
    ["empty code", (s: string) => `${REDIRECT}?code=&state=${s}`, "missing_param"],
    ["no query", () => REDIRECT, "missing_param"],
    ["state mismatch", () => url("state_wrong"), "state_mismatch"],
    ["state of another length", () => url("x"), "state_mismatch"],
  ])("rejects %s", (_label, build, reason) => {
    const a = attempt();
    expect(validateCallback(build(a.state), a, 2_000)).toEqual({ ok: false, reason });
  });

  it("rejects an expired attempt and a missing attempt", () => {
    const a = attempt(0);
    expect(validateCallback(url(a.state), a, LOGIN_ATTEMPT_TTL_MS)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(validateCallback(url(a.state), undefined, 0)).toEqual({ ok: false, reason: "no_attempt" });
  });
});

describe("callback URL extraction", () => {
  const cb = `${REDIRECT}?code=c&state=s`;

  it("recognizes only the configured scheme's callback path", () => {
    expect(isAuthCallbackUrl(cb, SCHEME)).toBe(true);
    expect(isAuthCallbackUrl(REDIRECT, SCHEME)).toBe(true);
    expect(isAuthCallbackUrl(`${REDIRECT}#x`, SCHEME)).toBe(true);
    expect(isAuthCallbackUrl("UNIWORKCHAT://auth/callback?code=c", SCHEME)).toBe(true);
    expect(isAuthCallbackUrl("uniworkchat-dev://auth/callback?code=c&state=s", SCHEME)).toBe(false);
    expect(isAuthCallbackUrl("uniworkchat-dev://auth/callback?code=c", "uniworkchat-dev")).toBe(true);
    expect(isAuthCallbackUrl(`${SCHEME}://open?url=%2Fchat`, SCHEME)).toBe(false);
    expect(isAuthCallbackUrl(`${REDIRECT}/extra`, SCHEME)).toBe(false);
    expect(isAuthCallbackUrl(42, SCHEME)).toBe(false);
  });

  it("finds the callback in cold-start / second-instance argv", () => {
    expect(extractAuthCallbackFromArgv(["C:\\UniChat.exe", "--flag", cb], SCHEME)).toBe(cb);
    expect(extractAuthCallbackFromArgv(["electron", ".", `${SCHEME}://open?url=%2Fx`], SCHEME)).toBeNull();
  });
});

describe("callback router", () => {
  const cb = (n: number) => `${REDIRECT}?code=c${n}&state=s`;

  it("holds a cold-start callback until start(), latest wins", () => {
    const router = createAuthCallbackRouter(["UniChat.exe", cb(1)], SCHEME);
    expect(router.openUrl(cb(2))).toBe(true);
    const route = vi.fn();
    router.start(route);
    expect(route.mock.calls).toEqual([[cb(2)]]);
    // started: routed at once, nothing held
    expect(router.secondInstance(["UniChat.exe", cb(3)])).toBe(true);
    expect(route).toHaveBeenLastCalledWith(cb(3));
    expect(route).toHaveBeenCalledTimes(2);
  });

  it("starts with nothing when argv has no callback and ignores foreign URLs", () => {
    const router = createAuthCallbackRouter(["electron", "."], SCHEME);
    expect(router.openUrl(`${SCHEME}://open?url=%2Fchat`)).toBe(false);
    expect(router.openUrl(undefined)).toBe(false);
    expect(router.secondInstance(["UniChat.exe", `${SCHEME}://open?url=%2Fchat`])).toBe(false);
    const route = vi.fn();
    router.start(route);
    expect(route).not.toHaveBeenCalled();
    expect(router.openUrl(cb(1))).toBe(true);
    expect(route).toHaveBeenCalledWith(cb(1));
  });
});
