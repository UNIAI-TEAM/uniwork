import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SymbolPicker } from "./symbol-picker";

function openPicker(props: { disabled?: boolean } = {}) {
  const onPick = vi.fn();
  render(<SymbolPicker onPick={onPick} disabled={props.disabled} />);
  fireEvent.click(screen.getByTestId("docx-symbol-picker"));
  return { onPick };
}

describe("SymbolPicker", () => {
  it("opens on the first category and inserts a picked glyph as text", async () => {
    const { onPick } = openPicker();
    expect(await screen.findByTestId("docx-symbol-grid")).toBeInTheDocument();
    expect(screen.getByTestId("docx-symbol-dollar")).toBeInTheDocument();
    expect(screen.getByTestId("docx-symbol-euro")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("docx-symbol-euro"));
    expect(onPick).toHaveBeenCalledWith("€");
    expect(onPick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("docx-symbol-grid")).not.toBeInTheDocument());
  });

  it("searches by localized name and reports an empty result", async () => {
    openPicker();
    const search = await screen.findByTestId("docx-symbol-search");

    fireEvent.change(search, { target: { value: "đồng" } });
    expect(screen.getByTestId("docx-symbol-dong")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-symbol-euro")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryByTestId("docx-symbol-grid")).not.toBeInTheDocument();
    expect(screen.getByText("Không có ký hiệu phù hợp")).toBeInTheDocument();
  });

  it("switches category and clears the search", async () => {
    openPicker();
    const search = await screen.findByTestId("docx-symbol-search");
    fireEvent.change(search, { target: { value: "euro" } });
    expect(screen.getByTestId("docx-symbol-euro")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("docx-symbol-category-greek"));
    expect(screen.getByTestId("docx-symbol-alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-symbol-euro")).not.toBeInTheDocument();
    expect(search).toHaveValue("");
  });

  it("names every glyph for assistive tech and keeps it keyboard reachable", async () => {
    openPicker();
    await screen.findByTestId("docx-symbol-grid");
    const euro = screen.getByTestId("docx-symbol-euro");
    expect(euro).toHaveAccessibleName("Euro");
    euro.focus();
    expect(document.activeElement).toBe(euro);
  });

  it("stays disabled on a read-only document", () => {
    openPicker({ disabled: true });
    expect(screen.getByTestId("docx-symbol-picker")).toBeDisabled();
    expect(screen.queryByTestId("docx-symbol-grid")).not.toBeInTheDocument();
  });
});
