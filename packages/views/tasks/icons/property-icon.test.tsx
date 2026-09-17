import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskProperty } from "@uniwork/core/types";
import { PropertyIcon } from "./property-icon";

function property(overrides: Partial<TaskProperty> = {}): TaskProperty {
  return {
    id: "prop-1",
    organization_id: "org-1",
    workspace_id: "ws-1",
    name: "Story points",
    type: "number",
    description: "",
    config: {},
    position: 0,
    usage_count: 0,
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    ...overrides,
  };
}

describe("PropertyIcon", () => {
  it("renders the persisted Multica icon key from task property config", () => {
    const { container } = render(
      <PropertyIcon property={property({ config: { icon: "rocket" } })} />,
    );
    expect(container.querySelector('[data-property-icon="rocket"]')).not.toBeNull();
  });

  it("falls back to the Multica number glyph for a number property", () => {
    const { container } = render(<PropertyIcon property={property()} />);
    expect(container.querySelector('[data-property-icon="hash"]')).not.toBeNull();
  });
});
