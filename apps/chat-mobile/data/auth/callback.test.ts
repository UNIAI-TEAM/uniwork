import { describe, expect, it, vi } from "vitest";
import { isAuthCallbackUrl, validateCallback } from "./callback";
import { LOGIN_ATTEMPT_TTL_MS, LoginAttemptStore } from "./pkce";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());

const SCHEME = "uniworkchat";
const REDIRECT = `${SCHEME}://auth/callback`;

function attempt(now = 1_000) {
  return new LoginAttemptStore().begin({
    clientId: "uniwork-chat-mobile",
    deploymentId: "default",
    redirectUri: REDIRECT,
    now,
  });
}

describe("callback validation", () => {
  const url = (state: string, extra = "") => `${REDIRECT}?code=abc&state=${encodeURIComponent(state)}${extra}`;

  it("accepts the exact redirect with code + state", async () => {
    const a = await attempt();
    expect(validateCallback(url(a.state), a, 2_000)).toEqual({ ok: true, code: "abc" });
  });

  it.each([
    ["wrong scheme", (s: string) => `uniworkchat-dev://auth/callback?code=abc&state=${s}`, "wrong_redirect"],
    ["foreign scheme", (s: string) => `https://evil.example/auth/callback?code=abc&state=${s}`, "wrong_redirect"],
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
  ])("rejects %s", async (_label, build, reason) => {
    const a = await attempt();
    expect(validateCallback(build(a.state), a, 2_000)).toEqual({ ok: false, reason });
  });

  it("rejects an expired attempt and a missing attempt", async () => {
    const a = await attempt(0);
    expect(validateCallback(url(a.state), a, LOGIN_ATTEMPT_TTL_MS)).toEqual({ ok: false, reason: "expired" });
    expect(validateCallback(url(a.state), undefined, 0)).toEqual({ ok: false, reason: "no_attempt" });
  });
});

describe("callback URL recognition", () => {
  it("recognizes only the configured scheme's callback path", () => {
    expect(isAuthCallbackUrl(`${REDIRECT}?code=c&state=s`, SCHEME)).toBe(true);
    expect(isAuthCallbackUrl(REDIRECT, SCHEME)).toBe(true);
    expect(isAuthCallbackUrl(`${REDIRECT}#x`, SCHEME)).toBe(true);
    expect(isAuthCallbackUrl("UNIWORKCHAT://auth/callback?code=c", SCHEME)).toBe(true);
    expect(isAuthCallbackUrl("uniworkchat-dev://auth/callback?code=c&state=s", SCHEME)).toBe(false);
    expect(isAuthCallbackUrl("uniworkchat-dev://auth/callback?code=c", "uniworkchat-dev")).toBe(true);
    expect(isAuthCallbackUrl(`${SCHEME}://open?url=%2Fchat`, SCHEME)).toBe(false);
    expect(isAuthCallbackUrl(`${REDIRECT}/extra`, SCHEME)).toBe(false);
    expect(isAuthCallbackUrl(42, SCHEME)).toBe(false);
  });
});
