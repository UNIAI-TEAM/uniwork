// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

/**
 * A tab strip is 32px tall by design, which is right for a mouse and wrong for
 * a thumb. The floor is asserted here rather than measured because jsdom has
 * no layout: what matters is that both halves are present, since the trigger's
 * `min-h-11` cannot grow inside a list pinned to `h-8`.
 */
describe("Tabs on a coarse pointer", () => {
  it("lifts the trigger to the 44px floor and lets the list grow with it", () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(container.querySelector('[data-slot="tabs-trigger"]')?.className).toContain(
      "pointer-coarse:min-h-11",
    );
    expect(container.querySelector('[data-slot="tabs-list"]')?.className).toContain(
      "pointer-coarse:group-data-horizontal/tabs:h-auto",
    );
  });
});
