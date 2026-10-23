import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  initSentry: vi.fn(() => false),
  configureRuntime: vi.fn(),
  setClientIdentity: vi.fn(),
  setCredentialFetch: vi.fn(),
  enablePerfMarks: vi.fn(),
  setBuildLacks: vi.fn(),
  setSchemaLogger: vi.fn(),
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { APP_ENV: "staging", apiUrl: "https://api.test", appUrl: "https://app.test", sentryDsn: "https://k@sentry.test/1" } } } }));
vi.mock("@uniwork/core/runtime-config", () => ({ configureRuntime: calls.configureRuntime }));
vi.mock("@uniwork/core/api/schema", () => ({ setSchemaLogger: calls.setSchemaLogger }));
vi.mock("./report", () => ({ schemaDriftLogger: "drift logger" }));
vi.mock("./sentry", () => ({ initSentry: calls.initSentry }));
vi.mock("./api", () => ({ api: { setClientIdentity: calls.setClientIdentity, setCredentialFetch: calls.setCredentialFetch } }));
vi.mock("./auth/strict-fetch", () => ({ strictFetch: "strict fetch" }));
vi.mock("./logger", () => ({ enablePerfMarks: calls.enablePerfMarks }));
vi.mock("./perf/marks-file", () => ({ writePerfMarks: "file sink" }));
vi.mock("./remote-config", () => ({ setBuildLacks: calls.setBuildLacks }));
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
    // An Android build lacks nothing; an iPhone build without calls keeps them off (lib/runtime-extra.ts › lackingFlags).
    expect(calls.setBuildLacks).toHaveBeenCalledWith([]);
    // A response parseWithFallback could not read reaches crash reporting by endpoint and paths (data/report.ts),
    // not core's silent no-op: a drifted list used to read as an empty one with nobody told.
    expect(calls.setSchemaLogger).toHaveBeenCalledWith("drift logger");
    expect(calls.setSchemaLogger.mock.invocationCallOrder[0]).toBeLessThan(calls.setCredentialFetch.mock.invocationCallOrder[0] ?? 0);
  });
});
