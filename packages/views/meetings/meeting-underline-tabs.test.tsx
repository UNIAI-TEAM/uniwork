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
});
