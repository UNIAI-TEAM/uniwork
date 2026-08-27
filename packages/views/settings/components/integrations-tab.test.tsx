import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { IntegrationsTab } from "./integrations-tab";

initI18n();

describe("IntegrationsTab", () => {
  it("shows an honest empty state without fake connectors", () => {
    render(<IntegrationsTab />);
    expect(screen.getByText("Chưa có tích hợp")).toBeInTheDocument();
    expect(screen.queryByText(/Slack/i)).toBeNull();
  });
});
