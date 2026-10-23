// What "online" means to the app. NetInfo's isConnected only says the phone
// has a link (Wi-Fi joined, a cellular bearer up); behind a captive portal or
// on Wi-Fi with a dead uplink it stays true, and the app used to spin sends
// through their timeouts and say nothing. The app counts as online only when
// nothing has shown the internet to be out of reach: isInternetReachable
// false is offline too, as WhatsApp and Telegram treat a captive portal.
// Android answers it from the OS (NET_CAPABILITY_VALIDATED); iOS asks
// reachabilityUrl, here UniChat's own /api/v1/healthz, so "reachable" means our
// API answers, not that some other site does. Under /api on purpose: the
// production edge sends only /api (and the MCP paths) to the server, and a bare
// /healthz on the public host reaches the web app, which never answers it.
//
// Any answer of our server proves the network reaches it, not only the
// liveness one: a server older than the build answers /api/v1/healthz with
// chi's `404 text/plain`, and an edge may answer a JSON 401. Reading those as
// "unreachable" made every iPhone of TestFlight build 4 offline for good
// (production did not serve the route yet): TanStack paused every query, sends
// waited, and the workspace picker said "no workspace" for a request it never
// sent. What is not our server: a page (a captive portal's login, whatever its
// status), a redirect, a 5xx (a portal's 511, a gateway with nothing behind
// it), and a 200 that is not the liveness answer.

/** The slice of NetInfo's state this reads. */
interface NetSnapshot {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
}

/** Online: a link, and the internet not known to be out of reach (unknown counts as reachable until a probe says otherwise). */
export function isOnlineState(state: NetSnapshot): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

/** Known to be offline: no link, or a link whose probe failed. Before NetInfo knows anything, not offline. */
export function isKnownOffline(state: NetSnapshot): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

/** The answer NetInfo reads: the status, the content type and the body. */
interface ProbeResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

/**
 * Our server answered the probe: 200 `{"status":"ok"}`, or any answer but a 200 that is neither a page, a redirect
 * nor a 5xx (an older server's 404, a JSON refusal). A captive portal's page, a redirect and a 5xx are not it.
 */
async function isHealthzAnswer(response: ProbeResponse): Promise<boolean> {
  const page = /text\/html/i.test(response.headers.get("Content-Type") ?? "");
  if (page || response.status >= 500 || (response.status >= 300 && response.status < 400)) return false;
  if (response.status !== 200) return true;
  const body = await response.json().then(
    (value) => value,
    () => null,
  );
  return typeof body === "object" && body !== null && "status" in body && body.status === "ok";
}

/** NetInfo's configuration for the build's API origin (lib/runtime-extra.ts › apiUrl). */
export function reachabilityConfig(apiUrl: string) {
  return {
    reachabilityUrl: `${apiUrl.replace(/\/+$/, "")}/api/v1/healthz`,
    // The server routes GET only (chi answers HEAD with 405).
    reachabilityMethod: "GET" as const,
    reachabilityTest: isHealthzAnswer,
    // While reachable, one probe a minute; while not, every 5 s, so coming back shows quickly.
    reachabilityLongTimeout: 60_000,
    reachabilityShortTimeout: 5_000,
    reachabilityRequestTimeout: 10_000,
  };
}
