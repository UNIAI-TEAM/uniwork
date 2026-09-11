import { describe, expect, it } from "vitest";
import { capabilityState } from "./registry";
import type { PublicConfig } from "../api/endpoints/config";

describe("capabilityState", () => {
  it("returns the unavailable unknown fallback when a key is missing", () => {
    const config: PublicConfig = {
      flags: {},
      rum_sample_rate: 0,
      work_management_capabilities: {},
    };
    expect(capabilityState(config, "tasks.vcs")).toEqual({
      status: "unavailable",
      reason_code: "capability_unknown",
      explanation_key: "capabilities.unknown",
    });
  });

  it("returns the published entry when present", () => {
    const config: PublicConfig = {
      flags: {},
      rum_sample_rate: 0,
      work_management_capabilities: {
        "tasks.core": {
          status: "available",
          reason_code: "",
          explanation_key: "",
        },
      },
    };
    expect(capabilityState(config, "tasks.core")).toEqual({
      status: "available",
      reason_code: "",
      explanation_key: "",
    });
  });
});
