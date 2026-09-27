import { describe, expect, it } from "vitest";
import { createEngineServiceHost } from "./index";
import { ENGINE_VERSION_TRUSTED, HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createHash } from "node:crypto";

describe("engine service host scaffold", () => {
  it("refuses to start without an engine endpoint - a typed refusal, not a silent default", () => {
    expect(() => createEngineServiceHost()).toThrow(HostCapabilityRefusal);
    expect(() => createEngineServiceHost()).toThrowError(/engineBaseUrl/);
  });

  it("binds a contract-shaped engine against an injected endpoint", () => {
    const host = createEngineServiceHost({ engineBaseUrl: "http://127.0.0.1:9000/engine" });
    expect(host.clientEngineVersion).toBe(ENGINE_VERSION_TRUSTED);
    expect(host.sha256(new TextEncoder().encode("hello"))).toBe(
      createHash("sha256").update("hello").digest("hex"),
    );
    expect(typeof host.engine.submit).toBe("function");
  });
});
