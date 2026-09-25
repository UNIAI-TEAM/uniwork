import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TaskSurfaceSelectionProvider,
  useCreateTaskSurfaceSelection,
  useIsTaskSelected,
  useSelectionSummary,
  useTaskSurfaceSelection,
  type TaskSurfaceSelectionHandle,
} from "./selection-context";

const renders: Record<string, number> = {};

function Row({ id }: { id: string }) {
  renders[id] = (renders[id] ?? 0) + 1;
  const selected = useIsTaskSelected(id);
  return <span data-testid={`row-${id}`}>{selected ? "on" : "off"}</span>;
}

function Summary({ ids }: { ids: string[] }) {
  return <span data-testid="summary">{useSelectionSummary(ids)}</span>;
}

function Count() {
  return <span data-testid="count">{useTaskSurfaceSelection().selectedIds.size}</span>;
}

const IDS = ["a", "b"];
let handle: TaskSurfaceSelectionHandle;

function Owner({ resetKey }: { resetKey: string }) {
  handle = useCreateTaskSurfaceSelection(resetKey);
  return (
    <TaskSurfaceSelectionProvider selection={handle}>
      <Row id="a" />
      <Row id="b" />
      <Summary ids={IDS} />
      <Count />
    </TaskSurfaceSelectionProvider>
  );
}

describe("task surface selection store", () => {
  it("re-renders only the row whose state flips, and resets on a new key", () => {
    const { rerender } = render(<Owner resetKey="one" />);
    const firstHandle = handle;
    const before = { ...renders };

    act(() => handle.toggle("a"));
    expect(screen.getByTestId("row-a")).toHaveTextContent("on");
    expect(screen.getByTestId("summary")).toHaveTextContent("some");
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(renders.a).toBe(before.a! + 1);
    expect(renders.b).toBe(before.b);

    act(() => handle.select(IDS));
    expect(screen.getByTestId("summary")).toHaveTextContent("all");

    rerender(<Owner resetKey="two" />);
    expect(handle).toBe(firstHandle);
    expect(screen.getByTestId("row-a")).toHaveTextContent("off");
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
    expect(screen.getByTestId("count")).toHaveTextContent("0");

    act(() => handle.select(["b"]));
    act(() => handle.deselect(["b"]));
    act(() => handle.toggle("a"));
    act(() => handle.clear());
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });
});
