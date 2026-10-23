import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildInfo } from "@/lib/build-info";
import { REDACTED } from "@/lib/redact";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  setTags: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  reactNavigationIntegration: vi.fn(() => ({ name: "ReactNavigation" })),
  TimeToFullDisplay: () => null,
  crashedLastRun: vi.fn(async () => true),
}));
vi.mock("@sentry/react-native", () => sdk);

import { breadcrumb, installReportSink, isReporting, reportError, setReportTag, setReportUser } from "./report";
import { crashedLastRun, initSentry, ScreenFullyDrawn, sentryNavigation } from "./sentry";

const info = (over: Partial<BuildInfo> = {}): BuildInfo => ({
  version: "0.3.0",
  build: "42",
  channel: "production",
  updateId: "0193a1b2-c3d4",
  runtimeVersion: "fp1",
  appId: "com.uniworkos.chat",
  os: "android",
  ...over,
});

afterEach(() => {
  installReportSink(null);
  for (const [name, fn] of Object.entries(sdk)) if (name !== "reactNavigationIntegration" && name !== "TimeToFullDisplay") (fn as ReturnType<typeof vi.fn>).mockReset();
});

describe("ScreenFullyDrawn", () => {
  it("is the SDK's full-display marker", () => {
    expect(ScreenFullyDrawn).toBe(sdk.TimeToFullDisplay);
  });
});

describe("initSentry", () => {
  it("starts nothing without a DSN, and cannot say whether the last run crashed", async () => {
    expect(initSentry({ dsn: undefined, environment: "production", info: info() })).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(isReporting()).toBe(false);
    await expect(crashedLastRun()).resolves.toBeNull();
    expect(sdk.crashedLastRun).not.toHaveBeenCalled();
  });

  it("asks the started SDK whether the last run crashed", async () => {
    initSentry({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "production", info: info() });
    sdk.crashedLastRun.mockResolvedValueOnce(true);
    await expect(crashedLastRun()).resolves.toBe(true);
  });

  it("starts the SDK named after the native build, private by default, and tags the update", () => {
    expect(initSentry({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "production", info: info() })).toBe(true);
    const options = sdk.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "production",
      // The OTA it runs is part of the release: crash-free sessions per update (lib/build-info.ts).
      release: "com.uniworkos.chat@0.3.0+42.android.ota.0193a1b2-c3d4",
      dist: "42",
      sendDefaultPii: false,
      enableAutoSessionTracking: true,
      attachScreenshot: false,
      attachViewHierarchy: false,
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.5,
      integrations: [sentryNavigation],
      enableAppStartTracking: true,
      enableNativeFramesTracking: true,
      enableStallTracking: true,
    });
    expect(sdk.reactNavigationIntegration).toHaveBeenCalledWith({ enableTimeToInitialDisplay: true });
    expect(sdk.setTags).toHaveBeenCalledWith({ channel: "production", update_id: "0193a1b2-c3d4", runtime_version: "fp1", os: "android" });

    const beforeSend = options.beforeSend as (e: object) => object;
    expect(beforeSend({ message: "for a@b.co", user: { id: "u1", email: "a@b.co" } })).toEqual({ message: `for ${REDACTED}`, user: { id: "u1" } });
    const beforeSendTransaction = options.beforeSendTransaction as (e: object) => object;
    expect(beforeSendTransaction({ spans: [{ description: "GET https://api.example.com/s?q=x" }] })).toEqual({
      message: undefined,
      spans: [{ description: `GET https://api.example.com/s?${REDACTED}`, data: undefined }],
    });
    const beforeBreadcrumb = options.beforeBreadcrumb as (b: object) => object;
    expect(beforeBreadcrumb({ message: "Bearer x" })).toEqual({ message: `Bearer ${REDACTED}`, data: undefined });
  });

  it("names an embedded, channel-less dev build and traces every dev session", () => {
    initSentry({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "dev", info: info({ build: "", channel: "", updateId: null, runtimeVersion: "" }) });
    const options = sdk.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).not.toHaveProperty("dist");
    expect(options.tracesSampleRate).toBe(1);
    expect(options.profilesSampleRate).toBe(1);
    expect(sdk.setTags).toHaveBeenCalledWith({ channel: "none", update_id: "embedded", runtime_version: "unknown", os: "android" });
  });

  it("becomes the report sink: errors, breadcrumbs, the user id and tags reach the SDK", () => {
    initSentry({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "staging", info: info() });
    const error = new TypeError("boom");
    reportError(error, { source: "boundary:root" });
    expect(sdk.captureException).toHaveBeenCalledWith(error, { tags: { source: "boundary:root" }, extra: undefined, level: "error" });
    breadcrumb("auth", "restored");
    expect(sdk.addBreadcrumb).toHaveBeenCalledWith({ category: "auth", message: "restored", level: "info", data: undefined });
    setReportUser("u1");
    setReportUser(null);
    expect(sdk.setUser.mock.calls).toEqual([[{ id: "u1" }], [null]]);
    setReportTag("workspace", "ws1");
    expect(sdk.setTag).toHaveBeenCalledWith("workspace", "ws1");
  });
});
