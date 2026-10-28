import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ScribeChipState } from "../meeting-scribe-chip";
import { UniStatusRow } from "./uni-status-row";

beforeAll(() => {
  initI18n();
});

const row = (props: Partial<Parameters<typeof UniStatusRow>[0]> = {}) => (
  <UniStatusRow state="on" hasLines={false} view="feed" onViewChange={() => {}} {...props} />
);

describe("UniStatusRow", () => {
  it.each<[ScribeChipState, boolean, string]>([
    ["on", false, "Đang nghe"],
    ["on", true, "Đang ghi"],
    ["paused", true, "Tạm dừng"],
    ["joining", false, "Đang vào"],
    ["failed", false, "Chưa vào được"],
    ["off", false, "Tắt"],
  ])("says the scribe is %s (lines: %s) as “%s”, beside its mark", (state, hasLines, label) => {
    render(row({ state, hasLines }));
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByTestId("uni-scribe-mark")).toHaveAttribute("data-scribe-state", state === "on" ? "live" : state);
  });

  it("offers the two views as radios, Highlights first, and a click on Transcript asks for it", () => {
    const onViewChange = vi.fn();
    render(row({ onViewChange }));
    const group = screen.getByRole("radiogroup", { name: "Cách xem" });
    const [feed, transcript] = screen.getAllByRole("radio");
    expect(group).toContainElement(feed!);
    expect(feed).toHaveAccessibleName("Tổng hợp");
    expect(feed).toHaveAttribute("aria-checked", "true");
    expect(transcript).toHaveAccessibleName("Lời thoại");
    expect(transcript).toHaveAttribute("aria-checked", "false");
    fireEvent.click(transcript!);
    expect(onViewChange).toHaveBeenCalledWith("transcript");
  });

  it("moves between the views with the arrow keys, one tab stop for the group", () => {
    const onViewChange = vi.fn();
    render(row({ onViewChange }));
    const feed = screen.getByRole("radio", { name: "Tổng hợp" });
    expect(feed).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Lời thoại" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(feed, { key: "ArrowRight" });
    expect(onViewChange).toHaveBeenCalledWith("transcript");
  });

  it("without the scribe capability shows only the view switch: no mark, no label", () => {
    render(row({ state: undefined }));
    expect(screen.queryByTestId("uni-scribe-mark")).not.toBeInTheDocument();
    expect(screen.queryByText(/Đang nghe|Đang ghi|Tắt/)).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Cách xem" })).toBeInTheDocument();
  });

  it("puts the end slot after the switch", () => {
    render(row({ view: "transcript", end: <button type="button">Tìm</button> }));
    const group = screen.getByRole("radiogroup");
    const end = screen.getByRole("button", { name: "Tìm" });
    expect(group.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
