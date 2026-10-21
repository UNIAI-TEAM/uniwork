// What every JavaScript runtime of the app does before its first request:
// crash reporting first (nothing starts without a DSN), the server URLs every
// data/* module reads per call, and the build's identity on every request.
// The app's root layout runs it at load; a headless task (an Android call
// push or a Decline while UniChat is closed, data/calls/call-wiring.ts) runs
// it too, since no screen loads there. Idempotent.
import { configureRuntime } from "@uniwork/core/runtime-config";
import Constants from "expo-constants";
import { clientHeaders } from "@/lib/build-info";
import { appEnvironment, perfMarksOn, runtimeFromExtra, sentryDsn } from "@/lib/runtime-extra";
import { api } from "./api";
import { buildInfo } from "./build-info";
import { enablePerfMarks } from "./logger";
import { initSentry } from "./sentry";

let booted = false;

export function bootRuntime(): void {
  if (booted) return;
  booted = true;
  const extra = Constants.expoConfig?.extra;
  initSentry({ dsn: sentryDsn(extra), environment: appEnvironment(extra), info: buildInfo() });
  enablePerfMarks(perfMarksOn(extra));
  configureRuntime(runtimeFromExtra(extra));
  api.setClientIdentity(clientHeaders(buildInfo()));
}
