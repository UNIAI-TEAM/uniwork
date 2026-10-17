// app.config.ts › extra → the core RuntimeConfig the app installs at boot.
// Pure so the derivation is testable; app/_layout.tsx hands it
// Constants.expoConfig.extra.
import type { RuntimeConfig } from "@uniwork/core/runtime-config";

const DEV_API_URL = "http://localhost:8080";
const DEV_APP_URL = "http://localhost:3000";

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** extra.eas.projectId, the one input of an Expo push token; undefined without EAS (spec §12 Q8). */
export function easProjectId(extra: Record<string, unknown> | undefined): string | undefined {
  const projectId = (extra?.eas as { projectId?: unknown } | undefined)?.projectId;
  return typeof projectId === "string" && projectId.length > 0 ? projectId : undefined;
}

export function runtimeFromExtra(extra: Record<string, unknown> | undefined): Partial<RuntimeConfig> {
  const apiUrl = stringOr(extra?.apiUrl, DEV_API_URL);
  return {
    apiUrl,
    appUrl: stringOr(extra?.appUrl, DEV_APP_URL),
    wsUrl: apiUrl.replace(/^http/, "ws"),
    clientPlatform: "mobile",
  };
}
