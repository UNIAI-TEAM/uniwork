import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AiStep } from "@uniwork/core/types";
import { AskUniProgress } from "./ask-uni-steps";

initI18n();

const step = (tool: string, label = ""): AiStep => ({ tool, label, counts: {} });

describe("AskUniProgress", () => {
  it("says what the last step is doing, with its label", () => {
    render(<AskUniProgress steps={[step("search", "quá hạn")]} running writing={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang tìm “quá hạn”…");
  });

  it("uses the no-label sentence for an empty label", () => {
    render(<AskUniProgress steps={[step("search")]} running writing={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Đang tìm…$/);
  });

  it("renders a label as text, not html", () => {
    render(<AskUniProgress steps={[step("get_task", "<b>x</b>")]} running writing={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("<b>x</b>");
    expect(screen.getByRole("status").querySelector("b")).toBeNull();
  });

  it("thinks before the first step and writes once the text starts", () => {
    const { rerender } = render(<AskUniProgress steps={[]} running writing={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("UNI đang suy nghĩ…");
    rerender(<AskUniProgress steps={[step("search", "a")]} running writing />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang viết câu trả lời…");
  });

  it("keeps the last step's sentence between steps, never blank", () => {
    render(<AskUniProgress steps={[step("list_tasks"), step("get_task", "Việc A")]} running writing={false} />);
    expect(screen.getByRole("status").textContent?.trim()).not.toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("Việc A");
  });

  it("shows the retry sentence for a blank tool, never an empty row", () => {
    render(<AskUniProgress steps={[step("search", "a"), step("")]} running writing={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra lại câu trả lời…");
  });

  it("falls back to the generic sentence for an unknown tool", () => {
    render(<AskUniProgress steps={[step("brand_new_tool", "x")]} running writing={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang xử lý…");
  });

  it("collapses to a count that expands to one line per step, retry included", () => {
    render(<AskUniProgress steps={[step("search", "quá hạn"), step("get_task", "Việc A"), step("")]} running={false} writing={false} />);
    expect(screen.queryByRole("status")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Xong sau 3 bước" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Đã tìm “quá hạn”")).toBeInTheDocument();
    expect(screen.getByText("Đã kiểm tra lại câu trả lời")).toBeInTheDocument();
  });

  it("renders nothing when done with no steps", () => {
    const { container } = render(<AskUniProgress steps={[]} running={false} writing={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
