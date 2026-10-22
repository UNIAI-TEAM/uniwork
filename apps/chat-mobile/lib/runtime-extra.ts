// app.config.ts › extra → the core RuntimeConfig the app installs at boot.
// Pure so the derivation is testable; app/_layout.tsx hands it
// Constants.expoConfig.extra.
import type { RuntimeConfig } from "@uniwork/core/runtime-config";
import { pathOf } from "./unknown-shape";

const DEV_API_URL = "http://localhost:8080";
const DEV_APP_URL = "http://localhost:3000";

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** extra.eas.projectId, the one input of an Expo push token; undefined without EAS (spec §12 Q8). */
export function easProjectId(extra: Record<string, unknown> | undefined): string | undefined {
  const projectId = pathOf(extra, "eas", "projectId");
  return typeof projectId === "string" && projectId.length > 0 ? projectId : undefined;
}

/** extra.sentryDsn (SENTRY_DSN at build time); undefined turns crash reporting off. */
export function sentryDsn(extra: Record<string, unknown> | undefined): string | undefined {
  const dsn = extra?.sentryDsn;
  return typeof dsn === "string" && /^https:\/\/\S+@\S+$/.test(dsn) ? dsn : undefined;
}

/** extra.perfMarks (UNICHAT_PERF_MARKS=1 at build time): log the startup marks CI measures (data/logger.ts › perfMark). */
export function perfMarksOn(extra: Record<string, unknown> | undefined): boolean {
  return extra?.perfMarks === true;
}

/**
 * The switches this binary cannot honour, whatever the server says: calling on an iPhone binary built without
 * extra.iosCalls (UNICHAT_IOS_CALLS=1, app.config.ts › iosCallsBuilt), which has no CallKit, no PushKit and no
 * background audio (Apple 2.3.1: a reviewed binary never grows a feature from a server switch).
 */
export function lackingFlags(os: string, extra: Record<string, unknown> | undefined): readonly "unichat_mobile_calls"[] {
  return os === "ios" && extra?.iosCalls !== true ? ["unichat_mobile_calls"] : [];
}

/** extra.APP_ENV: Sentry's environment, and what the Update-required screen says it runs on. */
export function appEnvironment(extra: Record<string, unknown> | undefined): "dev" | "staging" | "production" {
  const env = extra?.APP_ENV;
  return env === "staging" || env === "production" ? env : "dev";
}

/** extra.apiUrl: the API origin of this build (the dev server's when unset). */
export function apiUrlFromExtra(extra: Record<string, unknown> | undefined): string {
  return stringOr(extra?.apiUrl, DEV_API_URL);
}

export function runtimeFromExtra(extra: Record<string, unknown> | undefined): Partial<RuntimeConfig> {
  const apiUrl = apiUrlFromExtra(extra);
  return {
    apiUrl,
    appUrl: stringOr(extra?.appUrl, DEV_APP_URL),
    wsUrl: apiUrl.replace(/^http/, "ws"),
    clientPlatform: "mobile",
  };
}
