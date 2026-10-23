import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchableOptionPicker } from "./searchable-option-picker";

const manyOptions = Array.from({ length: 10 }, (_, i) => ({
  value: `p${i}`,
  label: `Dự án ${i}`,
  icon: <span data-testid={`icon-${i}`}>i{i}</span>,
}));

describe("SearchableOptionPicker", () => {
  it("pins a search field above the list when options exceed the threshold", async () => {
    render(
      <SearchableOptionPicker
        value="p0"
        options={manyOptions}
        onChange={vi.fn()}
        ariaLabel="Dự án"
        valueLabel="Dự án 0"
        searchPlaceholder="Tìm dự án"
        noResultsLabel="Không có kết quả"
      >
        <span>Dự án 0</span>
      </SearchableOptionPicker>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Dự án: Dự án 0" }));
    const search = await screen.findByPlaceholderText("Tìm dự án");
    expect(search).toBeInTheDocument();
    const listbox = screen.getByRole("listbox");
    expect(search.compareDocumentPosition(listbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("filters options by the pinned search query and keeps icons on rows", async () => {
    const onChange = vi.fn();
    render(
      <SearchableOptionPicker
        value={null}
        options={manyOptions}
        onChange={onChange}
        ariaLabel="Dự án"
        searchPlaceholder="Tìm dự án"
        noResultsLabel="Không có kết quả"
      >
        <span>Chọn dự án</span>
      </SearchableOptionPicker>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Dự án" }));
    const search = await screen.findByPlaceholderText("Tìm dự án");
    fireEvent.change(search, { target: { value: "Dự án 7" } });
    const list = screen.getByRole("listbox");
    expect(within(list).getByText("Dự án 7")).toBeInTheDocument();
    expect(within(list).getByTestId("icon-7")).toBeInTheDocument();
    expect(within(list).queryByText("Dự án 0")).not.toBeInTheDocument();
    fireEvent.click(within(list).getByText("Dự án 7"));
    expect(onChange).toHaveBeenCalledWith("p7");
  });

  it("hides search when the list is short", async () => {
    render(
      <SearchableOptionPicker
        value="a"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={vi.fn()}
        ariaLabel="Ngắn"
        searchPlaceholder="Tìm"
        noResultsLabel="Không"
      >
        <span>A</span>
      </SearchableOptionPicker>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Ngắn" }));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Tìm")).not.toBeInTheDocument();
  });

  it("maps the empty option to onChange(null)", async () => {
    const onChange = vi.fn();
    render(
      <SearchableOptionPicker
        value="p1"
        options={[{ value: "p1", label: "Apollo" }]}
        onChange={onChange}
        ariaLabel="Dự án"
        valueLabel="Apollo"
        searchPlaceholder="Tìm dự án"
        noResultsLabel="Không"
        emptyOption={{ value: "__none__", label: "Không có dự án" }}
      >
        <span>Apollo</span>
      </SearchableOptionPicker>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Dự án: Apollo" }));
    fireEvent.click(await screen.findByText("Không có dự án"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
