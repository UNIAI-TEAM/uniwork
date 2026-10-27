import { describe, expect, it } from "vitest";
import { buildDocumentsViewUrl, viewFromSearchParams } from "./documents-view-url";

const wsPaths = {
  documents: () => "/acme/doi/documents",
  documentsFolder: (id: string) => `/acme/doi/documents?folder=${id}`,
};

describe("documents view URL", () => {
  it("reads ?view=templates as the templates view", () => {
    expect(viewFromSearchParams(new URLSearchParams("view=templates"))).toEqual({ kind: "templates" });
  });

  it("builds ?view=templates for the templates view", () => {
    expect(buildDocumentsViewUrl(wsPaths, { kind: "templates" }, null)).toBe("/acme/doi/documents?view=templates");
  });

  it("round-trips the templates view through its own URL", () => {
    const url = buildDocumentsViewUrl(wsPaths, { kind: "templates" }, null);
    const query = url.split("?")[1] ?? "";
    expect(viewFromSearchParams(new URLSearchParams(query))).toEqual({ kind: "templates" });
  });

  it("keeps an unknown view on Home", () => {
    expect(viewFromSearchParams(new URLSearchParams("view=nope"))).toEqual({ kind: "home" });
  });
});
