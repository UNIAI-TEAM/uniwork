import { describe, expect, it } from "vitest";
import { pricingComparisonRows } from "./pricing-catalog";

const live = ["meeting.recording", "meeting.ai_summary", "documents.public_links", "office.ai_byok", "office.ai_cloud"];
const plan = (disabled: string[] = [], omitted: string[] = []) => ({
  features: [...live, "sso.oidc"].filter(key => !omitted.includes(key)).map(key => ({
    feature_key: key, enabled: !disabled.includes(key), quota_limit: null,
  })),
});

describe("useful public plan comparisons", () => {
  it("hides a table of identical included capabilities", () => {
    expect(pricingComparisonRows([plan(), plan(), plan()])).toEqual([]);
  });
  it("does not use catalog-only SSO to claim a real plan difference", () => {
    expect(pricingComparisonRows([plan(), plan(["sso.oidc"]), plan()])).toEqual([]);
  });
  it("hides a single plan or too few useful differences", () => {
    expect(pricingComparisonRows([plan()])).toEqual([]);
    expect(pricingComparisonRows([plan(), plan(["meeting.recording", "office.ai_cloud"])])).toEqual([]);
  });
  it("compares several enforced differences including Office AI, without repeating common flags", () => {
    expect(pricingComparisonRows([plan(), plan(["meeting.recording", "meeting.ai_summary", "office.ai_cloud"])])).toEqual([
      "meeting.recording", "meeting.ai_summary", "office.ai_cloud",
    ]);
  });
  it("does not present an undeclared feature as an excluded benefit", () => {
    expect(pricingComparisonRows([plan(), plan(["meeting.recording", "meeting.ai_summary", "office.ai_cloud"], ["office.ai_cloud"])])).toEqual([]);
  });
});
