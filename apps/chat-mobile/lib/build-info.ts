// What this running copy of UniChat is: the store version, the native build,
// the EAS Update channel and the update it runs (none for the embedded
// bundle). One derivation for the four places that say it — the API headers
// and the socket, crash reports (P0-2) and Settings › About (R3).
// Pure: data/build-info.ts reads the native modules and hands them here.

export interface BuildInputs {
  /** app.config.ts `version` as expo-constants reports it */
  configVersion: unknown;
  /** expo-application: the binary's own version and build number (versionCode / CFBundleVersion) */
  nativeVersion: string | null | undefined;
  nativeBuild: string | null | undefined;
  appId: string | null | undefined;
  /** expo-updates */
  channel: string | null | undefined;
  updateId: string | null | undefined;
  isEmbeddedLaunch: boolean | undefined;
  runtimeVersion: string | null | undefined;
  /** Platform.OS */
  os: string;
}

export interface BuildInfo {
  version: string;
  /** "" when the platform does not say (Expo Go, a test) */
  build: string;
  /** "" outside EAS Update (a dev build) */
  channel: string;
  /** null while the bundle embedded in the binary runs */
  updateId: string | null;
  runtimeVersion: string;
  appId: string;
  os: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function buildInfoFrom(input: BuildInputs): BuildInfo {
  const updateId = input.isEmbeddedLaunch === false ? text(input.updateId) : "";
  return {
    // The binary's version wins: an update's manifest repeats the config it was published with.
    version: text(input.nativeVersion) || text(input.configVersion) || "0.0.0",
    build: text(input.nativeBuild),
    channel: text(input.channel),
    updateId: updateId || null,
    runtimeVersion: text(input.runtimeVersion),
    appId: text(input.appId),
    os: input.os,
  };
}

/** The first block of an update id, enough to tell two updates apart on a screen. */
export function shortUpdateId(updateId: string | null): string {
  return updateId ? updateId.replace(/-.*$/, "") : "";
}

/**
 * Sentry's release: `<appId>@<version>+<build>` for the bundle embedded in the binary (the name its Gradle upload
 * gives the source maps), and `<appId>@<version>+<build>.ota.<update id>` while an OTA runs, so release health
 * (crash-free sessions) is counted per update and a bad one can be stopped on its own numbers
 * (scripts/mobile-release-health.mjs). Semver build metadata: dot-separated [0-9A-Za-z-]. Source maps match by
 * debug id, whatever the release is called.
 */
export function sentryRelease(info: BuildInfo): string {
  const id = info.appId || "unichat";
  const ota = info.updateId ? info.updateId.replace(/[^0-9A-Za-z-]/g, "") : "";
  const build = [info.build, ota && `ota.${ota}`].filter(Boolean).join(".");
  return build ? `${id}@${info.version}+${build}` : `${id}@${info.version}`;
}

/** The X-Client-* headers every REST call carries (server: middleware.ClientMetadata). */
export function clientHeaders(info: BuildInfo): Record<string, string> {
  return {
    "X-Client-Version": info.version,
    "X-Client-OS": info.os,
    "X-Client-Update-Id": info.updateId ?? "embedded",
  };
}

/**
 * -1, 0 or 1 as `a` is below, equal to or above `b`, number by number
 * (MAJOR.MINOR.PATCH; a missing part is 0, a suffix after "-" or "+" is
 * ignored). A part that is not a number makes the two incomparable: null, so
 * a malformed minimum never locks anyone out.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parts = (v: string) => v.trim().replace(/[-+].*$/, "").split(".");
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const x = left[i] ?? "0";
    const y = right[i] ?? "0";
    if (!/^\d+$/.test(x) || !/^\d+$/.test(y)) return null;
    const diff = Number(x) - Number(y);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** The "Update required" gate: only a minimum the running version is clearly below locks the app. */
export function isUpdateRequired(version: string, minimum: string): boolean {
  return minimum.trim() !== "" && compareVersions(version, minimum) === -1;
}
