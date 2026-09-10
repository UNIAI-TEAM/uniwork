import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingUnderlineTabs } from "./meeting-underline-tabs";

beforeAll(() => {
  initI18n();
});

describe("MeetingUnderlineTabs", () => {
  it("marks the active tab with aria-selected", () => {
    render(
      <MeetingUnderlineTabs
        tabs={["a", "b"] as const}
        value="a"
        onChange={() => {}}
        label={(tab) => tab}
      />,
    );
    expect(screen.getByRole("tab", { name: "a", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "b", selected: false })).toBeInTheDocument();
  });

  it("packs tabs to their label width instead of stretching them across the row", () => {
    render(
      <MeetingUnderlineTabs
        tabs={["chat", "people", "files"] as const}
        value="chat"
        onChange={() => {}}
        label={(tab) => tab}
      />,
    );
    const tablist = screen.getByRole("tablist");
    expect(tablist).not.toHaveClass("justify-between");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).not.toHaveClass("flex-1");
      expect(tab.className).toMatch(/\bshrink-0\b/);
      expect(tab.className).toMatch(/whitespace-nowrap/);
    }
  });

  it("draws the active indicator under the selected tab", () => {
    render(
      <MeetingUnderlineTabs
        tabs={["chat", "people"] as const}
        value="chat"
        onChange={() => {}}
        label={(tab) => tab}
      />,
    );
    const active = screen.getByRole("tab", { name: "chat", selected: true });
    const inactive = screen.getByRole("tab", { name: "people", selected: false });
    const indicator = active.querySelector("[data-slot='tab-indicator']");
    expect(indicator).not.toBeNull();
    expect(indicator?.className).toMatch(/\binset-x-0\b/);
    expect(indicator?.className).toMatch(/\bbottom-0\b/);
    expect(indicator?.className).toMatch(/\bbg-brand\b/);
    expect(inactive.querySelector("[data-slot='tab-indicator']")).toBeNull();
  });
});
