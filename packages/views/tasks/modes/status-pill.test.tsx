import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { PriorityFlag, StatusIcon, StatusPill } from "./status-pill";

beforeAll(() => {
  initI18n();
});

describe("StatusPill", () => {
  it("wears the category's solid tint with the label uppercase", () => {
    render(<StatusPill status="done" label="Xong" />);
    const pill = screen.getByText("Xong").closest('[data-slot="status-pill"]');
    expect(pill).toHaveClass("bg-tint-green-solid", "text-on-solid", "uppercase");
    expect(pill?.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the neutral primary fill for an unknown status", () => {
    render(<StatusPill status="mystery" label="?" />);
    expect(screen.getByText("?").closest('[data-slot="status-pill"]')).toHaveClass("bg-primary");
  });
});

describe("StatusIcon", () => {
  it("ports the progress-ring geometry and semantic category colour", () => {
    const { container } = render(<StatusIcon status="blocked" />);
    const icon = container.querySelector('[data-slot="status-icon"]');
    expect(icon).toHaveAttribute("viewBox", "0 0 14 14");
    expect(icon).toHaveClass("text-destructive");
    expect(icon?.querySelector('circle[r="6"]')).not.toBeNull();
    expect(icon?.querySelector("line")).not.toBeNull();
  });
});

describe("PriorityFlag", () => {
  it("uses the urgent badge geometry and remains named", () => {
    render(<PriorityFlag priority="urgent" />);
    const flag = screen.getByLabelText("Khẩn cấp");
    expect(flag.querySelector('svg[viewBox="0 0 16 16"] rect[rx="3"]')).not.toBeNull();
    expect(flag).toHaveClass("text-tint-red-foreground");
  });

  it("renders the three-bar scale in the labelled chip", () => {
    render(<PriorityFlag priority="high" withLabel />);
    const chip = screen.getByText("Cao").closest('[data-slot="priority-flag"]');
    expect(chip).toHaveClass("bg-tint-orange");
    expect(chip?.querySelectorAll("svg rect")).toHaveLength(3);
  });
});
