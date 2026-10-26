import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingNotesCard } from "./meeting-notes-card";

beforeAll(() => {
  initI18n();
});

describe("MeetingNotesCard", () => {
  it("keeps the model in the tooltip, as the detail page does, and marks the summary with the AI badge", () => {
    render(
      <MeetingNotesCard
        summary="- Chốt lịch"
        decisions={[]}
        summaryUpdatedAt="16:30"
        summaryModel="gpt-5.1-mini"
        summarySources="bản ghi lời thoại"
        emptyHint=""
      />,
    );
    const line = screen.getByTestId("meeting-summary-attribution");
    expect(line).toHaveAttribute("title", "gpt-5.1-mini");
    expect(line).not.toHaveTextContent("gpt-5.1-mini");
    expect(within(line).getByText("AI")).toBeInTheDocument();
    expect(line).toHaveTextContent("Từ bản ghi lời thoại · 16:30");
  });
});
