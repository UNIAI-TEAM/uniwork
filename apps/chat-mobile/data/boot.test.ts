import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  initSentry: vi.fn(() => false),
  configureRuntime: vi.fn(),
  setClientIdentity: vi.fn(),
  setCredentialFetch: vi.fn(),
  enablePerfMarks: vi.fn(),
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { APP_ENV: "staging", apiUrl: "https://api.test", appUrl: "https://app.test", sentryDsn: "https://k@sentry.test/1" } } } }));
vi.mock("@uniwork/core/runtime-config", () => ({ configureRuntime: calls.configureRuntime }));
vi.mock("./sentry", () => ({ initSentry: calls.initSentry }));
vi.mock("./api", () => ({ api: { setClientIdentity: calls.setClientIdentity, setCredentialFetch: calls.setCredentialFetch } }));
vi.mock("./auth/strict-fetch", () => ({ strictFetch: "strict fetch" }));
vi.mock("./logger", () => ({ enablePerfMarks: calls.enablePerfMarks }));
vi.mock("./perf/marks-file", () => ({ writePerfMarks: "file sink" }));
vi.mock("./build-info", () => ({ buildInfo: () => ({ version: "0.3.0", build: "17", os: "android", osVersion: "14", appId: "com.uniworkos.chat", channel: "internal", updateId: null, embedded: true, runtimeVersion: "fp" }) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("bootRuntime", () => {
  it("starts crash reporting, then the server URLs and the build's identity, once per runtime", async () => {
    const { bootRuntime } = await import("./boot");
    bootRuntime();
    bootRuntime();
    expect(calls.initSentry).toHaveBeenCalledTimes(1);
    expect(calls.initSentry).toHaveBeenCalledWith(expect.objectContaining({ dsn: "https://k@sentry.test/1", environment: "staging" }));
    expect(calls.initSentry.mock.invocationCallOrder[0]).toBeLessThan(calls.configureRuntime.mock.invocationCallOrder[0] ?? 0);
    expect(calls.configureRuntime).toHaveBeenCalledWith(expect.objectContaining({ apiUrl: "https://api.test", appUrl: "https://app.test" }));
    expect(calls.setClientIdentity).toHaveBeenCalledWith(expect.objectContaining({ "X-Client-Version": expect.any(String) }));
    expect(calls.setCredentialFetch).toHaveBeenCalledWith("strict fetch");
    // No perfMarks in this build's extra: marks off, with the file sink a measured build writes on iOS.
    expect(calls.enablePerfMarks).toHaveBeenCalledWith(false, "file sink");
  });
});
