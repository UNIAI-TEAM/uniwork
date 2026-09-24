import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ChatCatchUpResponse } from "@uniwork/core/types";
import { wrap } from "../test/api-mock";
import { ChatCatchUpSheet } from "./chat-catch-up-sheet";

vi.mock("./create-task-from-message-dialog", () => ({
  CreateTaskFromMessageDialog: ({
    open,
    messageId,
    messageBody,
  }: {
    open: boolean;
    messageId: string;
    messageBody: string;
  }) =>
    open ? (
      <div data-testid="create-task-dialog">
        {messageId}:{messageBody}
      </div>
    ) : null,
}));

beforeAll(() => {
  initI18n();
});

const brief: ChatCatchUpResponse = {
  summary: "An nhắc hạn F-09.",
  highlights: ["Spec F-09"],
  action_items: [
    {
      title: "Gửi bản nháp",
      owner: "An",
      due: "thứ Sáu",
      source_message_id: "msg-1",
    },
    { title: "Không nguồn", owner: "", due: "", source_message_id: "" },
  ],
  message_count: 3,
  mode: "unread",
  since: "2026-09-14T00:00:00Z",
  usage: { input_tokens: 10, output_tokens: 5 },
};

describe("ChatCatchUpSheet", () => {
  it("renders summary, highlights and action items", () => {
    render(
      wrap(
        <ChatCatchUpSheet
          open
          onOpenChange={vi.fn()}
          loading={false}
          error={null}
          result={brief}
          workspaceId="ws1"
        />,
      ),
    );

    expect(screen.getByText("An nhắc hạn F-09.")).toBeInTheDocument();
    expect(screen.getByText("Spec F-09")).toBeInTheDocument();
    expect(screen.getByText("Gửi bản nháp")).toBeInTheDocument();
    expect(screen.getByText("Không nguồn")).toBeInTheDocument();
  });

  it("opens create-task dialog when an action item with source is clicked", () => {
    render(
      wrap(
        <ChatCatchUpSheet
          open
          onOpenChange={vi.fn()}
          loading={false}
          error={null}
          result={brief}
          workspaceId="ws1"
        />,
      ),
    );

    // The whole row is no longer a button: creating a task is its own action beside "view source".
    fireEvent.click(screen.getByRole("button", { name: "Tạo việc" }));
    expect(screen.getByTestId("create-task-dialog")).toHaveTextContent("msg-1:Gửi bản nháp");
  });

  it("shows the recent-mode description", () => {
    render(
      wrap(
        <ChatCatchUpSheet
          open
          onOpenChange={vi.fn()}
          loading={false}
          error={null}
          result={{ ...brief, mode: "recent" }}
          workspaceId="ws1"
        />,
      ),
    );

    expect(
      screen.getByText(/48 giờ|48 hours/i),
    ).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(
      wrap(
        <ChatCatchUpSheet
          open
          onOpenChange={vi.fn()}
          loading={false}
          error={null}
          result={{
            summary: "Không có tin mới kể từ lần đọc trước.",
            highlights: [],
            action_items: [],
            message_count: 0,
            mode: "unread",
            since: "",
            usage: { input_tokens: 0, output_tokens: 0 },
          }}
          workspaceId="ws1"
        />,
      ),
    );

    expect(screen.getByText("Bạn đã bắt kịp")).toBeInTheDocument();
    expect(screen.getByText("Không có tin mới kể từ lần đọc trước.")).toBeInTheDocument();
  });

  it("labels the brief as AI output with its generation time and covered period", () => {
    render(
      wrap(
        <ChatCatchUpSheet
          open
          onOpenChange={vi.fn()}
          loading={false}
          error={null}
          result={brief}
          workspaceId="ws1"
          generatedAt={Date.parse("2026-09-14T08:30:00Z")}
        />,
      ),
    );

    expect(screen.getByText(/catch_up_attribution|Tóm tắt bởi AI/)).toBeInTheDocument();
    const times = document.querySelectorAll("time");
    expect([...times].map((node) => node.getAttribute("datetime"))).toEqual([
      "2026-09-14T08:30:00.000Z",
      "2026-09-14T00:00:00.000Z",
    ]);
  });

  it("jumps to the source message of a suggested action and closes", () => {
    const onOpenChange = vi.fn();
    const onJump = vi.fn();
    render(
      wrap(
        <ChatCatchUpSheet
          open
          onOpenChange={onOpenChange}
          loading={false}
          error={null}
          result={brief}
          workspaceId="ws1"
          onJumpToMessage={onJump}
        />,
      ),
    );

    // Only the item that carries a source message id offers the jump.
    const jumps = screen.getAllByRole("button", { name: /catch_up_view_source|tin gốc/i });
    expect(jumps).toHaveLength(1);
    fireEvent.click(jumps[0]!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onJump).toHaveBeenCalledWith("msg-1");
  });

  it("shows a skeleton with a screen-reader label while loading", () => {
    render(
      wrap(
        <ChatCatchUpSheet open onOpenChange={vi.fn()} loading error={null} result={null} workspaceId="ws1" />,
      ),
    );

    expect(screen.getByRole("status")).toHaveTextContent("UNI đang đọc tin chưa đọc…");
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  });

  it("shows a translated failure with the reason and a retry", () => {
    const onRetry = vi.fn();
    render(
      wrap(
        <ChatCatchUpSheet
          open
          onOpenChange={vi.fn()}
          loading={false}
          error="Tổ chức đã hết hạn mức token AI của tháng."
          result={null}
          onRetry={onRetry}
          workspaceId="ws1"
        />,
      ),
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Không bắt kịp được lúc này.");
    expect(alert).toHaveTextContent("Tổ chức đã hết hạn mức token AI của tháng.");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
