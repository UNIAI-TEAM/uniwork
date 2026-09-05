import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AgentBadge } from "./agent-badge";

initI18n();

describe("AgentBadge", () => {
  it("renders the localised label", () => {
    render(<AgentBadge />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });
});
