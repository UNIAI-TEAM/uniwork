// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/**
 * The panel is a tab stop, so a keyboard user lands on it after the tab list.
 * The global :focus-visible outline (base.css) is the only indicator, and an
 * `outline-none` on the panel switched it off: focus vanished on Tab.
 */
describe("TabsContent focus", () => {
  it("keeps the global focus-visible outline on a focusable panel", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel</TabsContent>
      </Tabs>,
    );
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("tabindex", "0");
    expect(panel.className).not.toContain("outline-none");
  });
});
