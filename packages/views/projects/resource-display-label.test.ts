import { describe, expect, it } from "vitest";
import type { ProjectResource } from "@uniwork/core/types/project";
import { resourceDisplayLabel } from "./resource-display-label";

function resource(over: Partial<ProjectResource> & Pick<ProjectResource, "resource_type">): ProjectResource {
  return {
    id: "r1",
    project_id: "p1",
    workspace_id: "w1",
    resource_ref: {},
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("resourceDisplayLabel", () => {
  it("prefers an explicit label", () => {
    expect(
      resourceDisplayLabel(
        resource({ resource_type: "github_repo", label: "  Docs  ", resource_ref: { url: "https://x" } }),
      ),
    ).toBe("Docs");
  });

  it("falls back to resource_type when ref is missing", () => {
    expect(
      resourceDisplayLabel(resource({ resource_type: "github_repo", resource_ref: null })),
    ).toBe("github_repo");
  });

  it("formats github repos with optional ref", () => {
    expect(
      resourceDisplayLabel(
        resource({
          resource_type: "github_repo",
          resource_ref: { url: "https://github.com/acme/app.git", ref: "main" },
        }),
      ),
    ).toBe("acme/app @ main");
    expect(
      resourceDisplayLabel(
        resource({
          resource_type: "github_repo",
          resource_ref: { url: "https://github.com/acme/app" },
        }),
      ),
    ).toBe("acme/app");
  });

  it("handles invalid github urls via path fallback", () => {
    expect(
      resourceDisplayLabel(
        resource({
          resource_type: "github_repo",
          resource_ref: { url: "not a url/acme/app.git" },
        }),
      ),
    ).toBe("acme/app");
  });

  it("returns resource_type when github url is empty", () => {
    expect(
      resourceDisplayLabel(resource({ resource_type: "github_repo", resource_ref: { url: "" } })),
    ).toBe("github_repo");
  });

  it("formats local directories from label or path", () => {
    expect(
      resourceDisplayLabel(
        resource({
          resource_type: "local_directory",
          resource_ref: { label: " Workspace ", local_path: "/tmp/x" },
        }),
      ),
    ).toBe("Workspace");
    expect(
      resourceDisplayLabel(
        resource({
          resource_type: "local_directory",
          resource_ref: { local_path: "  /tmp/x  " },
        }),
      ),
    ).toBe("/tmp/x");
    expect(
      resourceDisplayLabel(resource({ resource_type: "local_directory", resource_ref: {} })),
    ).toBe("local_directory");
  });

  it("returns resource_type for unknown kinds", () => {
    expect(
      resourceDisplayLabel(resource({ resource_type: "other", resource_ref: { url: "x" } })),
    ).toBe("other");
  });
});
