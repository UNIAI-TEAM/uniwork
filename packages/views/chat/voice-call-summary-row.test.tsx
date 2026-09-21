import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { VoiceCallSummaryRow } from "./voice-call-summary-row";

vi.mock("./create-task-from-message-dialog", () => ({
  CreateTaskFromMessageDialog: ({
    open,
    messageBody,
  }: {
    open: boolean;
    messageBody: string;
  }) => (open ? <div data-testid="create-task-dialog">{messageBody}</div> : null),
}));

beforeAll(() => {
  initI18n();
});

function summaryMessage(): ChatMessage {
  return {
    id: "m-summary",
    sender: "caller",
    body: "fallback body",
    ts: Date.now(),
    reactions: {},
    voiceCallSummary: {
      call_id: "call-1",
      call_log_message_id: "log-1",
      summary: "Đã chốt ship vào thứ Sáu.",
      highlights: ["Deadline thứ Sáu"],
      action_items: [
        {
          title: "Gửi báo cáo",
          owner: "Alice",
          due: "Thứ Sáu",
          source_message_id: "src-1",
        },
      ],
    },
  };
}

describe("VoiceCallSummaryRow", () => {
  it("renders summary, highlights, and action items", () => {
    render(
      wrap(
        <VoiceCallSummaryRow
          workspaceId="ws1"
          message={summaryMessage()}
          senderLabel="Alice"
        />,
      ),
    );

    // AI output says so in its label (Agent Principles).
    expect(screen.getByText("Tóm tắt cuộc gọi · AI")).toBeInTheDocument();
    expect(screen.getByText("Đã chốt ship vào thứ Sáu.")).toBeInTheDocument();
    expect(screen.getByText("Deadline thứ Sáu")).toBeInTheDocument();
    expect(screen.getByText("Gửi báo cáo")).toBeInTheDocument();
    expect(screen.getByText("Alice · Thứ Sáu")).toBeInTheDocument();
  });

  it("opens create-task dialog when action item is clicked", () => {
    render(
      wrap(
        <VoiceCallSummaryRow
          workspaceId="ws1"
          message={summaryMessage()}
          senderLabel="Alice"
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Gửi báo cáo/ }));
    expect(screen.getByTestId("create-task-dialog")).toHaveTextContent("Gửi báo cáo");
  });
});
