import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { SummaryGeneration } from "../meeting-summary/use-summary-generation";
import { MeetingSummaryCard } from "./summary-card";

beforeAll(() => {
  initI18n();
});

const writeText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

const SUMMARY = {
  id: "s1",
  meeting_id: "m1",
  summary: "- POS 3.0 lùi sang 12/11\n- Marketing giữ 120 triệu\n- Chưa chốt cách đào tạo",
  model: "gpt-5.1-mini",
  created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
};

/** Only the fields the card reads; the rest of the hook's surface is not its business. */
function gen(over: Partial<SummaryGeneration> = {}): SummaryGeneration {
  return {
    summary: SUMMARY,
    showGenerate: false,
    hasSource: true,
    generating: false,
    blockedReason: null,
    failure: null,
    summaryQuery: { isError: false },
    requestGenerate: vi.fn(),
    ...over,
  } as unknown as SummaryGeneration;
}

describe("MeetingSummaryCard", () => {
  it("lists each summary line and offers the refresh to a clerk only", () => {
    const { rerender } = render(<MeetingSummaryCard gen={gen({ showGenerate: true })} sourcesLabel="Lời thoại · chat" />);
    const card = screen.getByRole("region", { name: "Tóm tắt đến giờ" });
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
    expect(within(card).getByText("2 phút trước")).toBeInTheDocument();
    expect(within(card).getByText("Lời thoại · chat")).toBeInTheDocument();
    expect(within(card).getByText("Thư ký UNI:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cập nhật tóm tắt" })).toBeInTheDocument();

    rerender(<MeetingSummaryCard gen={gen()} sourcesLabel={null} />);
    expect(screen.queryByRole("button", { name: "Cập nhật tóm tắt" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI viết từ đâu" })).toBeInTheDocument();
  });

  it("refreshes through requestGenerate, and holds still with the reason while blocked", () => {
    const requestGenerate = vi.fn();
    const { rerender } = render(<MeetingSummaryCard gen={gen({ showGenerate: true, requestGenerate })} sourcesLabel={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật tóm tắt" }));
    expect(requestGenerate).toHaveBeenCalledTimes(1);

    rerender(
      <MeetingSummaryCard
        gen={gen({ showGenerate: true, requestGenerate, blockedReason: "Đang tạo tóm tắt, chờ xong rồi thử lại" })}
        sourcesLabel={null}
      />,
    );
    const refresh = screen.getByRole("button", { name: "Cập nhật tóm tắt" });
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    expect(refresh).toHaveAttribute("title", "Đang tạo tóm tắt, chờ xong rồi thử lại");
  });

  it("copies the summary as a titled bullet list", async () => {
    render(<MeetingSummaryCard gen={gen()} sourcesLabel={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép tóm tắt" }));
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "Tóm tắt:\n- POS 3.0 lùi sang 12/11\n- Marketing giữ 120 triệu\n- Chưa chốt cách đào tạo",
      ),
    );
  });

  it("says it is summarizing in place of the list while the model works", () => {
    render(<MeetingSummaryCard gen={gen({ generating: true })} sourcesLabel={null} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Đang tóm tắt…")).toBeInTheDocument();
  });

  it("shows the last run's failure in the card, with retry only when a second try can help", () => {
    const requestGenerate = vi.fn();
    const { rerender } = render(
      <MeetingSummaryCard
        gen={gen({ showGenerate: true, requestGenerate, failure: { text: "AI chưa tạo được tóm tắt.", retryable: true } })}
        sourcesLabel={null}
      />,
    );
    expect(screen.getByText("AI chưa tạo được tóm tắt.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(requestGenerate).toHaveBeenCalledTimes(1);

    rerender(
      <MeetingSummaryCard
        gen={gen({ showGenerate: true, requestGenerate, failure: { text: "Hết hạn mức.", retryable: false } })}
        sourcesLabel={null}
      />,
    );
    expect(screen.getByText("Hết hạn mức.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
  });

  it("is one row with Create for a clerk before there is a summary, and nothing for anyone else", () => {
    const requestGenerate = vi.fn();
    const { container, rerender } = render(
      <MeetingSummaryCard gen={gen({ summary: null, showGenerate: true, requestGenerate })} sourcesLabel={null} />,
    );
    expect(screen.getByText("Chưa có tóm tắt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(requestGenerate).toHaveBeenCalledTimes(1);

    rerender(<MeetingSummaryCard gen={gen({ summary: null })} sourcesLabel={null} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<MeetingSummaryCard gen={gen({ summary: null, showGenerate: true, hasSource: false })} sourcesLabel={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no Create while the summary could not be read: one may exist, and Create would replace it unasked", () => {
    const failedRead = { isError: true } as unknown as SummaryGeneration["summaryQuery"];
    const { container } = render(
      <MeetingSummaryCard gen={gen({ summary: null, showGenerate: true, summaryQuery: failedRead })} sourcesLabel={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
