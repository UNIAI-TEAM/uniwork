import { describe, expect, it } from "vitest";
import { buildInfoFrom, clientHeaders, compareVersions, isUpdateRequired, sentryRelease, shortUpdateId, updateNudgeFor, type BuildInputs } from "./build-info";

const inputs = (over: Partial<BuildInputs> = {}): BuildInputs => ({
  configVersion: "0.3.0",
  nativeVersion: "0.3.0",
  nativeBuild: "42",
  appId: "com.uniworkos.chat",
  channel: "production",
  updateId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  isEmbeddedLaunch: false,
  runtimeVersion: "f1e2d3",
  os: "android",
  ...over,
});

describe("buildInfoFrom", () => {
  it("names the binary, its channel and the update it runs", () => {
    expect(buildInfoFrom(inputs())).toEqual({
      version: "0.3.0",
      build: "42",
      channel: "production",
      updateId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      runtimeVersion: "f1e2d3",
      appId: "com.uniworkos.chat",
      os: "android",
    });
  });

  it("has no update id while the embedded bundle runs, or when expo-updates does not say", () => {
    expect(buildInfoFrom(inputs({ isEmbeddedLaunch: true })).updateId).toBeNull();
    expect(buildInfoFrom(inputs({ isEmbeddedLaunch: undefined })).updateId).toBeNull();
    expect(buildInfoFrom(inputs({ updateId: null })).updateId).toBeNull();
  });

  it("falls back to the config version, then 0.0.0, and to empty strings for what is unknown", () => {
    expect(buildInfoFrom(inputs({ nativeVersion: null })).version).toBe("0.3.0");
    expect(buildInfoFrom(inputs({ nativeVersion: undefined, configVersion: 3 }))).toMatchObject({ version: "0.0.0" });
    expect(buildInfoFrom(inputs({ nativeBuild: null, channel: undefined, runtimeVersion: null, appId: undefined }))).toMatchObject({
      build: "",
      channel: "",
      runtimeVersion: "",
      appId: "",
    });
  });
});

describe("shortUpdateId", () => {
  it("keeps the first block of an update id", () => {
    expect(shortUpdateId("0193a1b2-c3d4-7e5f")).toBe("0193a1b2");
    expect(shortUpdateId(null)).toBe("");
  });
});

describe("sentryRelease", () => {
  it("is <appId>@<version>+<build>.<os> for the embedded bundle, without the build when unknown", () => {
    expect(sentryRelease(buildInfoFrom(inputs({ isEmbeddedLaunch: true })))).toBe("com.uniworkos.chat@0.3.0+42.android");
    expect(sentryRelease(buildInfoFrom(inputs({ isEmbeddedLaunch: true, nativeBuild: null, appId: null, os: "ios" })))).toBe("unichat@0.3.0+ios");
    expect(sentryRelease(buildInfoFrom(inputs({ isEmbeddedLaunch: true, nativeBuild: null, os: "" })))).toBe("com.uniworkos.chat@0.3.0");
  });

  // Audit "health-gate-platform-blind": EAS counts iOS build numbers and Android version codes apart, so 0.3.0+5
  // can be both; the OS in the name keeps their crash-free sessions (and the store each one halts) apart.
  it("tells the two platforms apart when their build numbers collide", () => {
    const android = sentryRelease(buildInfoFrom(inputs({ isEmbeddedLaunch: true, nativeBuild: "5" })));
    const ios = sentryRelease(buildInfoFrom(inputs({ isEmbeddedLaunch: true, nativeBuild: "5", os: "ios" })));
    expect([android, ios]).toEqual(["com.uniworkos.chat@0.3.0+5.android", "com.uniworkos.chat@0.3.0+5.ios"]);
  });

  // Audit "rollout-gating-manual": crash-free sessions per OTA, so the release-health job can stop one update.
  it("names the update an OTA run is on, as semver build metadata", () => {
    expect(sentryRelease(buildInfoFrom(inputs()))).toBe("com.uniworkos.chat@0.3.0+42.android.ota.0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
    expect(sentryRelease(buildInfoFrom(inputs({ nativeBuild: null, updateId: "ab_c/1", os: "i_os" })))).toBe("com.uniworkos.chat@0.3.0+ios.ota.abc1");
  });
});

describe("clientHeaders", () => {
  it("names the version, the OS and the update (embedded when none)", () => {
    expect(clientHeaders(buildInfoFrom(inputs()))).toEqual({
      "X-Client-Version": "0.3.0",
      "X-Client-OS": "android",
      "X-Client-Update-Id": "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    });
    expect(clientHeaders(buildInfoFrom(inputs({ isEmbeddedLaunch: true, os: "ios" })))).toEqual({
      "X-Client-Version": "0.3.0",
      "X-Client-OS": "ios",
      "X-Client-Update-Id": "embedded",
    });
  });
});

describe("compareVersions", () => {
  it.each([
    ["0.3.0", "0.3.0", 0],
    ["0.2.9", "0.3.0", -1],
    ["0.10.0", "0.9.9", 1],
    ["1.0", "1.0.0", 0],
    ["1.0.1", "1.0", 1],
    ["1.0.0-beta.1", "1.0.0", 0],
    ["0.3.0+42", "0.3.1", -1],
  ] as const)("%s vs %s → %s", (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want);
  });

  it("refuses to compare a malformed version", () => {
    expect(compareVersions("0.3.x", "0.3.0")).toBeNull();
    expect(compareVersions("0.3.0", "")).toBeNull();
  });
});

describe("isUpdateRequired", () => {
  it("locks only a version clearly below a set minimum", () => {
    expect(isUpdateRequired("0.2.0", "0.3.0")).toBe(true);
    expect(isUpdateRequired("0.3.0", "0.3.0")).toBe(false);
    expect(isUpdateRequired("0.4.0", "0.3.0")).toBe(false);
    expect(isUpdateRequired("0.2.0", "")).toBe(false);
    expect(isUpdateRequired("0.2.0", "  ")).toBe(false);
    // a malformed minimum never locks anyone out
    expect(isUpdateRequired("0.2.0", "latest")).toBe(false);
  });
});

// Audit "remote-config-restart-bound": the only way to move people to a new version was the blocking gate; a soft
// nudge comes first, once per version, and never on top of the gate.
describe("updateNudgeFor", () => {
  const nudge = (over: Partial<Parameters<typeof updateNudgeFor>[0]> = {}) =>
    updateNudgeFor({ version: "0.3.0", minimum: "", recommended: "0.3.2", dismissed: null, ...over });

  it("names the recommended version to a phone below it", () => {
    expect(nudge()).toBe("0.3.2");
    // Dismissing an older nudge does not hide a newer one.
    expect(nudge({ dismissed: "0.3.1" })).toBe("0.3.2");
  });

  it("says nothing on that version or above, once dismissed, without a recommendation, or when the gate already blocks", () => {
    expect(nudge({ version: "0.3.2" })).toBeNull();
    expect(nudge({ version: "0.4.0" })).toBeNull();
    expect(nudge({ dismissed: "0.3.2" })).toBeNull();
    expect(nudge({ recommended: " " })).toBeNull();
    expect(nudge({ recommended: "latest" })).toBeNull();
    expect(nudge({ minimum: "0.3.1" })).toBeNull();
  });
});
