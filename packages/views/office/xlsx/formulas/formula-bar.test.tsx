import { fireEvent, render, screen, act } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { XlsxFormulaBar } from "./formula-bar";

// F1 (UNI-926, visual-r2): the formula bar committed its stale text into the
// NEXT clicked cell. These tests drive the bar with a minimal editor harness
// that mirrors xlsx-editor.tsx: the harness owns the draft and the active
// cell, commits the draft into the active cell, and refreshes the draft when
// the selection moves. The regression is that after Enter the bar kept its
// text, so the blur from the selection-changing click re-committed it into
// the newly selected cell.

interface Cell { text: string }

function Harness({ onWrite }: { onWrite: (address: string, text: string) => void }) {
  const cells: Record<string, Cell> = { B2: { text: "" }, F9: { text: "" } };
  const [address, setAddress] = useState("B2");
  const [draft, setDraft] = useState(cells.B2!.text);
  const commit = () => { onWrite(address, draft); cells[address] = { text: draft }; };
  // The editor refreshes the draft whenever the active cell changes.
  const select = (next: string) => { setAddress(next); setDraft(cells[next]?.text ?? ""); };
  return (
    <div>
      <XlsxFormulaBar value={draft} onChange={setDraft} onCommit={commit} />
      <button type="button" data-testid="select-F9" onClick={() => select("F9")}>F9</button>
      <button type="button" data-testid="select-B2" onClick={() => select("B2")}>B2</button>
      <span data-testid="active">{address}</span>
    </div>
  );
}

const bar = () => screen.getByTestId("xlsx-formula-bar");

describe("XlsxFormulaBar commit lifecycle (F1)", () => {
  it("does not re-commit the committed text into the next clicked cell", () => {
    const onWrite = vi.fn();
    render(<Harness onWrite={onWrite} />);

    // Type 123 into B2's bar and press Enter: the draft commits once.
    fireEvent.change(bar(), { target: { value: "123" } });
    fireEvent.keyDown(bar(), { key: "Enter" });
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenLastCalledWith("B2", "123");

    // Click F9: the selection changes, the bar refreshes, and the blur that
    // rides the click must NOT write the stale 123 into F9.
    fireEvent.click(screen.getByTestId("select-F9"));
    fireEvent.blur(bar());
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).not.toHaveBeenCalledWith("F9", "123");
    expect(bar()).toHaveValue("");
  });

  it("still commits an uncommitted draft on a plain blur", () => {
    const onWrite = vi.fn();
    render(<Harness onWrite={onWrite} />);
    fireEvent.change(bar(), { target: { value: "hello" } });
    fireEvent.blur(bar());
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenLastCalledWith("B2", "hello");
  });

  it("commits a fresh draft after the selection moves", () => {
    const onWrite = vi.fn();
    render(<Harness onWrite={onWrite} />);
    fireEvent.click(screen.getByTestId("select-F9"));
    fireEvent.change(bar(), { target: { value: "9" } });
    fireEvent.keyDown(bar(), { key: "Enter" });
    expect(onWrite).toHaveBeenLastCalledWith("F9", "9");
  });
});