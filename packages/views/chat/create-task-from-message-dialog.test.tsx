import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";

vi.mock("@uniwork/core/chat", () => ({
  useCreateTaskFromChatMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@uniwork/core/tasks", () => ({
  useProjects: () => ({ data: { projects: [] } }),
}));

vi.mock("@uniwork/core/workspaces", () => ({
  useMembers: () => ({ data: [] }),
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("CreateTaskFromMessageDialog", () => {
  it("prefills the title from the message body", () => {
    wrap(
      <CreateTaskFromMessageDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws1"
        messageId="m1"
        messageBody="Sửa bug login ngay hôm nay"
      />,
    );
    expect(screen.getByLabelText("chat.link.title_label")).toHaveValue(
      "Sửa bug login ngay hôm nay",
    );
  });
});
