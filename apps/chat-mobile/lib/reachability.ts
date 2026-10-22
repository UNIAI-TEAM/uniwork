// What "online" means to the app. NetInfo's isConnected only says the phone
// has a link (Wi-Fi joined, a cellular bearer up); behind a captive portal or
// on Wi-Fi with a dead uplink it stays true, and the app used to spin sends
// through their timeouts and say nothing. The app counts as online only when
// nothing has shown the internet to be out of reach: isInternetReachable
// false is offline too, as WhatsApp and Telegram treat a captive portal.
// Android answers it from the OS (NET_CAPABILITY_VALIDATED); iOS asks
// reachabilityUrl, here UniChat's own /healthz, so "reachable" means our API
// answers, not that some other site does.

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

/** The answer NetInfo reads: only the status and the body. */
interface ProbeResponse {
  status: number;
  json(): Promise<unknown>;
}

/** /healthz answered as our server does (200 `{"status":"ok"}`); a captive portal's 200 login page is not it. */
async function isHealthzAnswer(response: ProbeResponse): Promise<boolean> {
  if (response.status !== 200) return false;
  const body = await response.json().then(
    (value) => value,
    () => null,
  );
  return typeof body === "object" && body !== null && "status" in body && body.status === "ok";
}

/** NetInfo's configuration for the build's API origin (lib/runtime-extra.ts › apiUrl). */
export function reachabilityConfig(apiUrl: string) {
  return {
    reachabilityUrl: `${apiUrl.replace(/\/+$/, "")}/healthz`,
    // The server routes GET only (chi answers HEAD with 405).
    reachabilityMethod: "GET" as const,
    reachabilityTest: isHealthzAnswer,
    // While reachable, one probe a minute; while not, every 5 s, so coming back shows quickly.
    reachabilityLongTimeout: 60_000,
    reachabilityShortTimeout: 5_000,
    reachabilityRequestTimeout: 10_000,
  };
}
