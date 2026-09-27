// Capability rows this service build reports. Honest by construction: a row
// is supported only when a handler is bound, and even then its evidence stays
// "pending" - the product claim (proven) belongs to the format lane's fixture
// evidence, not to the fact that a handler exists.

import {
  ENGINE_VERSION_TRUSTED,
  grantableOperations,
  type CapabilityEntry,
  type OfficeFormat,
} from "@uniwork/office-contracts";
import { BOUND_OPERATIONS } from "./worker/handlers.ts";

/** Q7 (docs/office/g1g2/q7-blocker.md): no BIFF8/ODF/RTF/XLSB -> OOXML engine
 * is chosen. convert stays a named M1 blocker and answers 501. */
export const Q7_BLOCKER = "docs/office/g1g2/q7-blocker.md";

export function isBound(operation: string, format: string): boolean {
  return BOUND_OPERATIONS.includes(operation + ":" + format);
}

function capabilityRows(format: OfficeFormat): CapabilityEntry[] {
  return grantableOperations
    .filter((op) => op !== "capability")
    .map((op): CapabilityEntry => {
      if (op === "convert") {
        return { operation: op, supported: false, runtime: "none", evidence_level: "pending", reason: "Q7 blocker: " + Q7_BLOCKER };
      }
      if (isBound(op, format)) {
        return {
          operation: op,
          supported: true,
          runtime: "internal_service",
          evidence_level: "pending",
          reason: "bound in the engine service; product evidence belongs to the format lane",
        };
      }
      return { operation: op, supported: false, runtime: "none", evidence_level: "pending", reason: "not bound in this service build" };
    });
}

export function capabilityResult(format: OfficeFormat, maxInputBytes: number): Record<string, unknown> {
  return {
    job_id: "capability-" + format,
    state: "completed",
    operation: "capability",
    engine_version: ENGINE_VERSION_TRUSTED,
    format,
    capabilities: capabilityRows(format),
    limits: { max_input_bytes: maxInputBytes },
  };
}
