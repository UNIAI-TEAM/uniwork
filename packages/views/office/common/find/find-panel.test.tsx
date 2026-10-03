import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import {
  applyEdits,
  FindReplacePanel,
  type FindReplaceEdit,
  type FindReplacePanelHandle,
  type FindReplacePanelProps,
} from "./index";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

/** Minimal host: the panel reports edits, the harness applies them to its text. */
function renderPanel(initial: string) {
  const onReplace = vi.fn();
  const onReplaceAll = vi.fn();
  const ref = createRef<FindReplacePanelHandle>();
  const view = render(
    <FindReplacePanel ref={ref} text={initial} onReplace={onReplace} onReplaceAll={onReplaceAll} />,
  );
  const type = (value: string, testId: string) =>
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
  return { view, onReplace, onReplaceAll, ref, type };
}

const PANEL_PROPS: Pick<FindReplacePanelProps, "text"> = { text: "" };

describe("FindReplacePanel", () => {
  it("documents its public props through the barrel", () => {
    expect(PANEL_PROPS.text).toBe("");
  });

  it("counts matches as the query changes", () => {
    const { type } = renderPanel("one two one");
    expect(screen.getByTestId("find-replace-count")).toBeEmptyDOMElement();
    type("one", "find-replace-query");
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("2 matches");
    type("zzz", "find-replace-query");
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("No matches");
  });

  it("cycles the active match with next and previous", () => {
    const onActiveMatchChange = vi.fn();
    render(<FindReplacePanel text="a a a" onActiveMatchChange={onActiveMatchChange} />);
    fireEvent.change(screen.getByTestId("find-replace-query"), { target: { value: "a" } });
    expect(onActiveMatchChange).toHaveBeenLastCalledWith({ start: 0, end: 1 }, 0);
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(onActiveMatchChange).toHaveBeenLastCalledWith({ start: 2, end: 3 }, 1);
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    // Wraps back to the first match.
    expect(onActiveMatchChange).toHaveBeenLastCalledWith({ start: 0, end: 1 }, 0);
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(onActiveMatchChange).toHaveBeenLastCalledWith({ start: 4, end: 5 }, 2);
  });

  it("replaces the current match and lets the host apply the edit", () => {
    const { type, onReplace, onReplaceAll } = renderPanel("cat cat");
    type("cat", "find-replace-query");
    type("dog", "find-replace-value");
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onReplace).toHaveBeenCalledWith({ start: 4, end: 7, replacement: "dog" }, 1);
    expect(onReplaceAll).not.toHaveBeenCalled();
  });

  it("replaces every match and passes a non-overlapping edit list", () => {
    const { type, onReplaceAll } = renderPanel("cat cat");
    type("cat", "find-replace-query");
    type("dog", "find-replace-value");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    const edits = onReplaceAll.mock.calls[0]?.[0] as FindReplaceEdit[];
    expect(edits).toEqual([
      { start: 0, end: 3, replacement: "dog" },
      { start: 4, end: 7, replacement: "dog" },
    ]);
    expect(applyEdits("cat cat", edits)).toBe("dog dog");
  });

  it("recounts on the text the host passes back", () => {
    const { view, type } = renderPanel("cat cat");
    type("cat", "find-replace-query");
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("2 matches");
    view.rerender(<FindReplacePanel text="dog dog" />);
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("No matches");
  });

  it("drives case sensitive, whole word and regex from the toggles", () => {
    const { type } = renderPanel("Cat cat concatenate");
    type("cat", "find-replace-query");
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("3 matches");
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("2 matches");
    fireEvent.click(screen.getByRole("checkbox", { name: "Whole word" }));
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("1 match");
    fireEvent.click(screen.getByRole("checkbox", { name: "Regular expression" }));
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("1 match");
  });

  it("shows the invalid-pattern state and blocks replace on a bad pattern", () => {
    const { type, onReplaceAll } = renderPanel("anything");
    type("(", "find-replace-query");
    fireEvent.click(screen.getByRole("checkbox", { name: "Regular expression" }));
    expect(screen.getByTestId("find-replace-query")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("find-replace-count")).toHaveTextContent("Invalid pattern");
    expect(screen.getByRole("button", { name: "Replace all" })).toHaveAttribute("aria-disabled", "true");
    expect(onReplaceAll).not.toHaveBeenCalled();
  });

  it("steps with Enter, steps back with Shift+Enter and closes on Escape", () => {
    const onClose = vi.fn();
    const onActiveMatchChange = vi.fn();
    render(<FindReplacePanel text="a a" onClose={onClose} onActiveMatchChange={onActiveMatchChange} />);
    const query = screen.getByTestId("find-replace-query");
    fireEvent.change(query, { target: { value: "a" } });
    fireEvent.keyDown(query, { key: "Enter" });
    expect(onActiveMatchChange).toHaveBeenLastCalledWith({ start: 2, end: 3 }, 1);
    fireEvent.keyDown(query, { key: "Enter", shiftKey: true });
    expect(onActiveMatchChange).toHaveBeenLastCalledWith({ start: 0, end: 1 }, 0);
    fireEvent.keyDown(query, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores Enter while an IME is composing", () => {
    const onActiveMatchChange = vi.fn();
    render(<FindReplacePanel text="a a" onActiveMatchChange={onActiveMatchChange} />);
    const query = screen.getByTestId("find-replace-query");
    fireEvent.change(query, { target: { value: "a" } });
    onActiveMatchChange.mockClear();
    fireEvent.keyDown(query, { key: "Enter", isComposing: true });
    expect(onActiveMatchChange).not.toHaveBeenCalled();
  });

  it("focuses the find field through its imperative handle", async () => {
    const { ref } = renderPanel("abc");
    ref.current?.focus();
    await waitFor(() => expect(screen.getByTestId("find-replace-query")).toHaveFocus());
  });

  it("renders nothing while closed and supports a controlled replacement", () => {
    const onReplaceValueChange = vi.fn();
    const { view } = renderPanel("abc");
    view.rerender(<FindReplacePanel text="abc" open={false} />);
    expect(screen.queryByTestId("find-replace-panel")).not.toBeInTheDocument();
    view.rerender(
      <FindReplacePanel text="abc" replaceValue="fixed" onReplaceValueChange={onReplaceValueChange} />,
    );
    expect(screen.getByTestId("find-replace-value")).toHaveValue("fixed");
    fireEvent.change(screen.getByTestId("find-replace-value"), { target: { value: "next" } });
    expect(onReplaceValueChange).toHaveBeenCalledWith("next");
  });
});
