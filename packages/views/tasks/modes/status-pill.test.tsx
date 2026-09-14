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
  it("colours the glyph by category", () => {
    const { container } = render(<StatusIcon status="blocked" />);
    expect(container.querySelector('[data-slot="status-icon"]')).toHaveClass("text-tint-red-foreground");
  });
});

describe("PriorityFlag", () => {
  it("is a filled flag named by its priority", () => {
    render(<PriorityFlag priority="urgent" />);
    const flag = screen.getByLabelText("Khẩn cấp");
    expect(flag).toHaveClass("fill-current", "text-tint-red-foreground");
  });

  it("renders the labelled chip on the pale tint", () => {
    render(<PriorityFlag priority="high" withLabel />);
    expect(screen.getByText("Cao").closest('[data-slot="priority-flag"]')).toHaveClass("bg-tint-orange");
  });
});
