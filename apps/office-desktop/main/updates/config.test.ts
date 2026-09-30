import { describe, expect, it } from "vitest";
import { DEFAULT_UPDATE_CONFIG, UpdateConfigError, parseUpdateConfig } from "./config";

describe("desktop update configuration", () => {
  it("is disabled with no feed or publisher by default", () => {
    expect(DEFAULT_UPDATE_CONFIG).toEqual({ enabled: false, feed: null, publisher: null, channel: "dev" });
  });

  it("refuses a missing configuration", () => {
    expect(() => parseUpdateConfig(undefined)).toThrowError(expect.objectContaining({ code: "missing" } satisfies Partial<UpdateConfigError>));
  });

  it("refuses invalid values and upstream-shaped feeds", () => {
    expect(() => parseUpdateConfig({ enabled: "yes" })).toThrowError(expect.objectContaining({ code: "invalid" } satisfies Partial<UpdateConfigError>));
    expect(() => parseUpdateConfig({ enabled: false, feed: "https://upstream.example/feed", publisher: null, channel: "dev" })).toThrowError(expect.objectContaining({ code: "invalid" } satisfies Partial<UpdateConfigError>));
  });

  it("refuses a channel that is not the manifest channel", () => {
    expect(() => parseUpdateConfig({ enabled: false, feed: null, publisher: null, channel: "stable" })).toThrowError(expect.objectContaining({ code: "wrong-channel" } satisfies Partial<UpdateConfigError>));
  });

  it("refuses every enabled unsigned-dev configuration", () => {
    expect(() => parseUpdateConfig({ enabled: true, feed: null, publisher: null, channel: "dev" })).toThrowError(expect.objectContaining({ code: "not-allowed-in-dev" } satisfies Partial<UpdateConfigError>));
    expect(() => parseUpdateConfig({ enabled: true, feed: "https://upstream.example/feed", publisher: "upstream", channel: "dev" })).toThrowError(expect.objectContaining({ code: "not-allowed-in-dev" } satisfies Partial<UpdateConfigError>));
  });
});
