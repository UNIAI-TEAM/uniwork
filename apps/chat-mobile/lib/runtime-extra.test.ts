import { describe, expect, it } from "vitest";
import { appEnvironment, easProjectId, lackingFlags, runtimeFromExtra, sentryDsn, perfMarksOn } from "./runtime-extra";

describe("easProjectId", () => {
  it("reads extra.eas.projectId and nothing else", () => {
    expect(easProjectId({ eas: { projectId: "p1" } })).toBe("p1");
    expect(easProjectId({ eas: { projectId: "" } })).toBeUndefined();
    expect(easProjectId({ eas: { projectId: 7 } })).toBeUndefined();
    expect(easProjectId({})).toBeUndefined();
    expect(easProjectId(undefined)).toBeUndefined();
  });
});

describe("runtimeFromExtra", () => {
  it("derives the ws(s) origin from the api origin and names the mobile platform", () => {
    expect(runtimeFromExtra({ apiUrl: "https://api.example", appUrl: "https://app.example" })).toEqual({
      apiUrl: "https://api.example",
      appUrl: "https://app.example",
      wsUrl: "wss://api.example",
      clientPlatform: "mobile",
    });
    expect(runtimeFromExtra({ apiUrl: "http://192.168.1.20:8080", appUrl: "http://192.168.1.20:3000" }).wsUrl).toBe(
      "ws://192.168.1.20:8080",
    );
  });

  it("falls back to the dev servers when extra is missing or malformed", () => {
    expect(runtimeFromExtra(undefined)).toMatchObject({ apiUrl: "http://localhost:8080", appUrl: "http://localhost:3000" });
    expect(runtimeFromExtra({ apiUrl: 42 })).toMatchObject({ apiUrl: "http://localhost:8080", wsUrl: "ws://localhost:8080" });
  });
});

describe("sentryDsn", () => {
  it("reads an https DSN with a key and nothing else", () => {
    expect(sentryDsn({ sentryDsn: "https://abc123@o1.ingest.sentry.io/42" })).toBe("https://abc123@o1.ingest.sentry.io/42");
    expect(sentryDsn({ sentryDsn: "" })).toBeUndefined();
    expect(sentryDsn({ sentryDsn: "http://abc@host/1" })).toBeUndefined();
    expect(sentryDsn({ sentryDsn: "https://host/1" })).toBeUndefined();
    expect(sentryDsn({ sentryDsn: 7 })).toBeUndefined();
    expect(sentryDsn(undefined)).toBeUndefined();
  });
});

describe("perfMarksOn", () => {
  it("is on only when the build set it", () => {
    expect(perfMarksOn({ perfMarks: true })).toBe(true);
    expect(perfMarksOn({ perfMarks: "true" })).toBe(false);
    expect(perfMarksOn(undefined)).toBe(false);
  });
});

describe("appEnvironment", () => {
  it("is staging or production when the build says so, dev otherwise", () => {
    expect(appEnvironment({ APP_ENV: "production" })).toBe("production");
    expect(appEnvironment({ APP_ENV: "staging" })).toBe("staging");
    expect(appEnvironment({ APP_ENV: "qa" })).toBe("dev");
    expect(appEnvironment(undefined)).toBe("dev");
  });
});

describe("lackingFlags", () => {
  it("keeps calling off on an iPhone binary built without calls, and only there", () => {
    expect(lackingFlags("ios", undefined)).toEqual(["unichat_mobile_calls"]);
    expect(lackingFlags("ios", { iosCalls: "true" })).toEqual(["unichat_mobile_calls"]);
    expect(lackingFlags("ios", { iosCalls: true })).toEqual([]);
    expect(lackingFlags("android", undefined)).toEqual([]);
  });
});
