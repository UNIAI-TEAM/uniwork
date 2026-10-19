import { describe, expect, it } from "vitest";
import { principalTypeLabel } from "./access-report-labels";

// A stub that answers with the key, so the test sees which key a label asks for.
const key = ((k: string) => k) as Parameters<typeof principalTypeLabel>[0];

describe("principalTypeLabel", () => {
  it("names the principal types the share panel knows", () => {
    expect(principalTypeLabel(key, "user")).toBe("documents.share.principal_user");
    expect(principalTypeLabel(key, "workspace")).toBe("documents.share.principal_workspace");
  });

  it("asks for its own key for a principal type it does not know, not a level key", () => {
    expect(principalTypeLabel(key, "robot")).toBe("documents.accessReport.principal_other");
  });
});
