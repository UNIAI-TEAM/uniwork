import { describe, expect, it } from "vitest";
import { EMPTY_QUESTIONNAIRE, mergeQuestionnaire } from "./types";
import { ONBOARDING_STEP_ORDER } from "./step-order";

describe("mergeQuestionnaire", () => {
  it("pre-fills answers but resets skipped flags", () => {
    const m = mergeQuestionnaire({ role: "manager", role_skipped: true, use_case: "meetings", use_case_skipped: true });
    expect(m.role).toBe("manager");
    expect(m.role_skipped).toBe(false);
    expect(m.use_case).toEqual(["meetings"]);
    expect(m.use_case_skipped).toBe(false);
  });
  it("handles empty", () => {
    expect(mergeQuestionnaire({})).toEqual(EMPTY_QUESTIONNAIRE);
  });
});

describe("step order", () => {
  it("excludes welcome and ends with invite", () => {
    expect(ONBOARDING_STEP_ORDER).toEqual(["about_you", "organization", "workspace", "invite"]);
  });
});
