import { describe, expect, it } from "vitest";
import { dispatchOfficeError } from "@uniwork/core/office";
import { visualsFrozen } from "./xlsx-editor-model";

describe("visualsFrozen (review m-3, ambiguous-save window)", () => {
  it("freezes while a save runs and while a failed save's outcome is unknown", () => {
    expect(visualsFrozen({ state: "saving", activeIntentId: "intent-1", error: null })).toBe(true);
    // engine_timeout exhausted its retries: the intent stays pending until a reconcile.
    const timeout = dispatchOfficeError({ code: "engine_timeout", error_class: "engine" });
    expect(timeout.ambiguous).toBe(true);
    expect(visualsFrozen({ state: "error", activeIntentId: "intent-1", error: timeout })).toBe(true);
  });

  it("freezes after a non-ambiguous failure whose commit outcome is unknown (review-session m-2)", () => {
    const refused = dispatchOfficeError({ code: "xlsx_rule_sets_dropped", error_class: "engine" });
    expect(refused.ambiguous).toBe(false);
    expect(visualsFrozen({ state: "error", activeIntentId: "intent-1", error: refused, outcomeUnknown: true })).toBe(true);
    expect(visualsFrozen({ state: "error", activeIntentId: null, error: refused, outcomeUnknown: true })).toBe(false);
  });

  it("unfreezes once the outcome is known: settled, refused, or nothing pending", () => {
    expect(visualsFrozen({ state: "dirty", activeIntentId: null, error: null })).toBe(false);
    const refused = dispatchOfficeError({ code: "xlsx_rule_sets_dropped", error_class: "engine" });
    expect(visualsFrozen({ state: "error", activeIntentId: "intent-1", error: refused })).toBe(false);
    const settled = dispatchOfficeError({ code: "engine_timeout", error_class: "engine" });
    expect(visualsFrozen({ state: "error", activeIntentId: null, error: settled })).toBe(false);
  });
});
