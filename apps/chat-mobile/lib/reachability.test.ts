// Audit P2 "netinfo-reachability": a captive portal or dead Wi-Fi is offline, not a link to spin sends on.
import { describe, expect, it } from "vitest";
import { isKnownOffline, isOnlineState, reachabilityConfig } from "./reachability";

const answer = (status: number, body: unknown) => ({ status, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) });

describe("online", () => {
  it("needs a link and no failed probe; unknown reachability counts as reachable", () => {
    expect(isOnlineState({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isOnlineState({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(isOnlineState({ isConnected: true })).toBe(true);
    // A captive portal, or Wi-Fi with a dead uplink.
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isOnlineState({ isConnected: false, isInternetReachable: null })).toBe(false);
    expect(isOnlineState({ isConnected: null })).toBe(false);
  });

  it("is known offline only once NetInfo says so", () => {
    expect(isKnownOffline({ isConnected: null, isInternetReachable: null })).toBe(false);
    expect(isKnownOffline({ isConnected: true, isInternetReachable: null })).toBe(false);
    expect(isKnownOffline({ isConnected: false })).toBe(true);
    expect(isKnownOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
  });
});

describe("the probe", () => {
  // Under /api: the production edge sends only /api (and the MCP paths) to the server; a bare /healthz on the
  // public host reaches the web app, never answers {"status":"ok"}, and left every iPhone offline for good.
  it("is our /api/v1/healthz, by GET, answered as our server answers it", async () => {
    const config = reachabilityConfig("https://api.unichat.example/");
    expect(config).toMatchObject({ reachabilityUrl: "https://api.unichat.example/api/v1/healthz", reachabilityMethod: "GET", reachabilityLongTimeout: 60_000 });
    expect(reachabilityConfig("http://10.0.2.2:8090").reachabilityUrl).toBe("http://10.0.2.2:8090/api/v1/healthz");
    expect(new URL(config.reachabilityUrl).pathname.startsWith("/api/")).toBe(true);
    expect(await config.reachabilityTest(answer(200, { status: "ok" }))).toBe(true);
    // A portal's login page, a redirect, a server down, a body that is not ours.
    expect(await config.reachabilityTest(answer(200, new Error("not json")))).toBe(false);
    expect(await config.reachabilityTest(answer(302, { status: "ok" }))).toBe(false);
    expect(await config.reachabilityTest(answer(503, { status: "ok" }))).toBe(false);
    expect(await config.reachabilityTest(answer(200, { status: "down" }))).toBe(false);
    expect(await config.reachabilityTest(answer(200, null))).toBe(false);
    expect(await config.reachabilityTest(answer(200, "ok"))).toBe(false);
    expect(await config.reachabilityTest(answer(200, {}))).toBe(false);
  });
});
