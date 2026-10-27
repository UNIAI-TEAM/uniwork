import { describe, expect, it } from "vitest";
import { PROJECT_STATUS_CONFIG } from "./config";

describe("project status badge contrast", () => {
  it("uses solid fills with on-solid text for colored badges in both themes", () => {
    expect(PROJECT_STATUS_CONFIG.in_progress).toMatchObject({
      badgeBg: "bg-warning-solid",
      badgeText: "text-on-solid",
    });
    expect(PROJECT_STATUS_CONFIG.completed).toMatchObject({
      badgeBg: "bg-info-solid",
      badgeText: "text-on-solid",
    });
  });
});
