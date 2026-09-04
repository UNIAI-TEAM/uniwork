import { beforeEach, describe, expect, it } from "vitest";
import { configureRuntime, resetRuntimeConfig, runtimeConfig } from "./runtime-config";

describe("runtime config", () => {
  beforeEach(resetRuntimeConfig);

  it("falls back to the dev defaults when the platform never configures it", () => {
    // Unit tests and render harnesses import core without an app around it.
    // Those defaults are what keeps them working with zero wiring.
    expect(runtimeConfig()).toEqual({
      apiUrl: "http://localhost:8080",
      wsUrl: "ws://localhost:8080",
      appUrl: "http://localhost:3000",
      chatScopeSubscriptionLimit: 25,
    });
  });

  it("merges a partial config instead of replacing the whole object", () => {
    // The platform layer may know one origin and not another (a preview
    // deployment sets appUrl only). Replacing would silently blank the rest.
    configureRuntime({ apiUrl: "https://api.uniwork.app" });
    expect(runtimeConfig().apiUrl).toBe("https://api.uniwork.app");
    expect(runtimeConfig().wsUrl).toBe("ws://localhost:8080");
  });
});
