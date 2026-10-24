import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AiStep } from "@uniwork/core/types";
import { AskUniProgress } from "./ask-uni-steps";

initI18n();

const step = (tool: string, label = "", over: Partial<AiStep> = {}): AiStep => ({ tool, label, counts: {}, note: "", thought: "", kind: "", ...over });

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

  it("shows each step's thinking and note under it while running, then the thinking still being written", () => {
    render(
      <AskUniProgress
        steps={[step("search", "quá hạn", { thought: "Cần **việc quá hạn** trước.", note: "Mình tìm việc quá hạn." })]}
        running
        writing={false}
        thinking="Giờ xem ai đang giữ"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("UNI đang suy nghĩ…");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Cần việc quá hạn trước.");
    expect(items[0]?.querySelector("strong")).toHaveTextContent("việc quá hạn");
    expect(items[0]).toHaveTextContent("Đã tìm “quá hạn”");
    expect(items[0]).toHaveTextContent("Mình tìm việc quá hạn.");
    expect(items[1]).toHaveTextContent("Giờ xem ai đang giữ");
  });

  it("does not say the step the status line names twice while it runs", () => {
    render(<AskUniProgress steps={[step("search", "a", { note: "Tìm a." }), step("get_task", "Việc A", { note: "Mở việc A." })]} running writing={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Việc A");
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Đã tìm “a”");
    expect(items[1]).toHaveTextContent(/^Mở việc A\.$/);
  });

  it("folds the timeline away once the answer is being written", () => {
    render(<AskUniProgress steps={[step("search", "a", { note: "Tìm a." })]} running writing thinking="" />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang viết câu trả lời…");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("keeps the timeline hidden while running when there is nothing but the steps' names", () => {
    render(<AskUniProgress steps={[step("search", "a")]} running writing={false} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("counts only tool steps when done, and shows the closing thought without a step sentence", () => {
    render(<AskUniProgress steps={[step("search", "a", { note: "Tìm a." }), step("", "", { kind: "think", thought: "Đủ rồi." })]} running={false} writing={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Xong sau 1 bước" }));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent(/^Đủ rồi\.$/);
  });

  it("says it thought it over when the answer took thinking but no tool", () => {
    render(<AskUniProgress steps={[step("", "", { kind: "think", thought: "Câu dễ." })]} running={false} writing={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Đã suy nghĩ" }));
    expect(screen.getByText("Câu dễ.")).toBeInTheDocument();
  });

  it("renders nothing when done with no steps", () => {
    const { container } = render(<AskUniProgress steps={[]} running={false} writing={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
