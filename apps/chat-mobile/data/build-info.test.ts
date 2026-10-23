import { describe, expect, it, vi } from "vitest";

vi.mock("expo-application", () => ({ nativeApplicationVersion: "0.3.0", nativeBuildVersion: "17", applicationId: "com.uniworkos.chat.staging" }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "0.3.0" } } }));
vi.mock("expo-updates", () => ({ channel: "internal", updateId: "abc-def", isEmbeddedLaunch: false, runtimeVersion: "fp1" }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { buildInfo } from "./build-info";

describe("buildInfo", () => {
  it("reads the native modules once and keeps the answer", () => {
    const first = buildInfo();
    expect(first).toEqual({
      version: "0.3.0",
      build: "17",
      channel: "internal",
      updateId: "abc-def",
      runtimeVersion: "fp1",
      appId: "com.uniworkos.chat.staging",
      os: "android",
    });
    expect(buildInfo()).toBe(first);
  });
});
