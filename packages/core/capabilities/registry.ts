import type { PublicConfig } from "../api/endpoints/config";
import type { CapabilityState, WorkManagementCapability } from "./types";

const UNKNOWN: CapabilityState = {
  status: "unavailable",
  reason_code: "capability_unknown",
  explanation_key: "capabilities.unknown",
};

/**
 * Resolve a Work Management capability for UI gating. Missing or drifted
 * entries degrade to unavailable with a stable reason — never invent success.
 */
export function capabilityState(
  config: PublicConfig,
  key: WorkManagementCapability,
): CapabilityState {
  const entry = config.work_management_capabilities[key];
  if (!entry) return UNKNOWN;
  if (entry.status !== "available" && entry.status !== "unavailable") {
    return UNKNOWN;
  }
  return {
    status: entry.status,
    reason_code: entry.reason_code,
    explanation_key: entry.explanation_key,
  };
}
