// What every JavaScript runtime of the app does before its first request:
// crash reporting first (nothing starts without a DSN), the server URLs every
// data/* module reads per call, the build's identity on every request, and the
// fetch that refuses a redirect for every request that carries a credential,
// and where a response the app could not read is reported (core's
// parseWithFallback is silent until a host gives it a logger).
// The app's root layout runs it at load; a headless task (an Android call
// push or a Decline while UniChat is closed, data/calls/call-wiring.ts) runs
// it too, since no screen loads there. Idempotent.
import { setSchemaLogger } from "@uniwork/core/api/schema";
import { configureRuntime } from "@uniwork/core/runtime-config";
import Constants from "expo-constants";
import { clientHeaders } from "@/lib/build-info";
import { appEnvironment, lackingFlags, perfMarksOn, runtimeFromExtra, sentryDsn } from "@/lib/runtime-extra";
import { api } from "./api";
import { strictFetch } from "./auth/strict-fetch";
import { buildInfo } from "./build-info";
import { enablePerfMarks } from "./logger";
import { writePerfMarks } from "./perf/marks-file";
import { setBuildLacks } from "./remote-config";
import { schemaDriftLogger } from "./report";
import { initSentry } from "./sentry";

let booted = false;

export function bootRuntime(): void {
  if (booted) return;
  booted = true;
  const extra = Constants.expoConfig?.extra;
  initSentry({ dsn: sentryDsn(extra), environment: appEnvironment(extra), info: buildInfo() });
  // A measured build (UNICHAT_PERF_MARKS=1) also keeps its marks in a file: iOS's release log has no room for them.
  enablePerfMarks(perfMarksOn(extra), writePerfMarks);
  configureRuntime(runtimeFromExtra(extra));
  // Before any screen or headless task reads a switch: what this binary cannot do stays off.
  setBuildLacks(lackingFlags(buildInfo().os, extra));
  // Before the first response: a fallback parseWithFallback takes reaches crash reporting by endpoint and paths.
  setSchemaLogger(schemaDriftLogger);
  api.setClientIdentity(clientHeaders(buildInfo()));
  // Before the first request: the bearer never follows a redirect (data/auth/strict-fetch.ts).
  api.setCredentialFetch(strictFetch);
}
