import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { LinkTaskDialog } from "./link-task-dialog";

const state = vi.hoisted(() => ({
  tasks: { data: [] as unknown[], isLoading: false, isError: false },
  mutateAsync: vi.fn(),
}));

vi.mock("@uniwork/core/chat", () => ({
  useLinkChatMessage: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}));

vi.mock("@uniwork/core/tasks", () => ({
  useTasks: () => ({ refetch: vi.fn(), ...state.tasks }),
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const makeTasks = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, identifier: `LUN-${i}`, title: `Việc ${i}` }));

const dialog = <LinkTaskDialog open onOpenChange={vi.fn()} workspaceId="ws1" messageId="m1" />;

const emptyText = () => document.querySelector("[cmdk-empty]")?.textContent ?? "";

describe("LinkTaskDialog", () => {
  beforeEach(() => {
    state.mutateAsync.mockReset();
    state.tasks = { data: makeTasks(3), isLoading: false, isError: false };
  });

  it("shows a skeleton while tasks load", () => {
    state.tasks = { data: [], isLoading: true, isError: false };
    wrap(dialog);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("uses a real listbox of options driven from the search box", () => {
    wrap(dialog);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "LUN-2" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("says when the list is capped", () => {
    state.tasks = { data: makeTasks(45), isLoading: false, isError: false };
    wrap(dialog);
    expect(screen.getAllByRole("option")).toHaveLength(40);
    expect(screen.getByText(/results_capped|40/)).toBeInTheDocument();
  });

  it("tells an empty workspace apart from no match", () => {
    state.tasks = { data: [], isLoading: false, isError: false };
    const { unmount } = wrap(dialog);
    const noTasks = emptyText();
    unmount();
    state.tasks = { data: makeTasks(3), isLoading: false, isError: false };
    wrap(dialog);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    const noMatch = emptyText();
    expect(noTasks).not.toBe("");
    expect(noMatch).not.toBe("");
    expect(noMatch).not.toBe(noTasks);
  });

  it("shows the error when linking fails", async () => {
    state.mutateAsync.mockRejectedValue(new Error("boom"));
    wrap(dialog);
    fireEvent.click(screen.getAllByRole("option")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Gắn" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(state.mutateAsync).toHaveBeenCalledWith({
      messageId: "m1",
      target_type: "task",
      target_id: "t1",
    });
  });
});
