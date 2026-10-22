// The native ring path's half in JavaScript (modules/unichat-calls › NativeCallPush.kt, review
// "killed-app-ring-js-dependent"). A call push for a closed or backgrounded Android app rings from the FCM service
// itself, with no JavaScript started; what it needs that only JavaScript knows is written to the phone here
// (configureRing): whether calls ring at all — the calls switch (data/remote-config.ts) —, the app's link scheme,
// and the notification's words in the app's language. Written at launch and again whenever one of them changes, so a
// switch turned off on the server stops native rings as soon as this phone hears it. The session is not part of it:
// a signed-out phone's push token is gone from the server, and a session still being restored (offline, refreshing)
// must never silence a ring.
// What the native path did meanwhile is counted when JavaScript next runs (reportNativeRings): the call_push
// outcome and, for a ring, how long after the server rang it the phone did (call_ring).
import { RING_ROOM_PLACEHOLDER } from "@/lib/call-push";
import type { ProductEvent } from "../analytics";
import type { NativeCalls, NativeRingConfig } from "./native-calls";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The config the native path rings with: on with the calls switch on. */
export function nativeRingConfig(t: Translate, state: { enabled: boolean; scheme: string }): NativeRingConfig {
  return {
    enabled: state.enabled,
    scheme: state.scheme,
    incomingVoice: t("mobile.call_notify.incoming_voice"),
    incomingVideo: t("mobile.call_notify.incoming_video"),
    incomingGroup: t("mobile.call_notify.incoming_group", { room: RING_ROOM_PLACEHOLDER }),
    groupFallback: t("mobile.call_notify.group_fallback"),
    unknownCaller: t("mobile.call_notify.unknown_caller"),
    answerLabel: t("chat.voice_call_accept"),
    declineLabel: t("chat.voice_call_decline"),
  };
}

export interface NativeRingSyncEnv {
  native: Pick<NativeCalls, "available" | "configureRing">;
  t: Translate;
  scheme: string;
  callsOn: () => boolean;
  /** Calls `listener` whenever the switch or the language may have changed; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}

/** Writes the ring config now and on every change that alters it; the function it returns stops listening. */
export function installNativeRingSync(env: NativeRingSyncEnv): () => void {
  if (!env.native.available) return () => undefined;
  let written = "";
  const write = () => {
    const config = nativeRingConfig(env.t, { enabled: env.callsOn(), scheme: env.scheme });
    const key = JSON.stringify(config);
    if (key === written) return;
    written = key;
    env.native.configureRing(config);
  };
  write();
  return env.subscribe(write);
}

/** Counts what the native ring path did while JavaScript was not running (RingReports.kt). */
export function reportNativeRings(native: Pick<NativeCalls, "takeRingReports">, track: (event: ProductEvent) => void): void {
  for (const report of native.takeRingReports()) {
    switch (report.result) {
      case "native":
        track({ name: "call_push", result: "native" });
        if (report.latencyMs >= 0) track({ name: "call_ring", result: "native", duration_ms: report.latencyMs });
        break;
      case "ignored":
      case "cleared":
        track({ name: "call_push", result: report.result });
        break;
      default:
        // A result a newer module writes that this bundle does not know: not counted rather than miscounted.
        break;
    }
  }
}
