import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PillButton } from "../../common/pill-button";
import { PickerItem, PropertyPicker } from "./property-picker";

function Harness({ onPick = vi.fn() }: { onPick?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      searchable
      searchPlaceholder="Tìm giá trị…"
      onSearchChange={setQuery}
      triggerRender={<PillButton />}
      trigger="Trạng thái"
    >
      {query !== "done" ? (
        <PickerItem emptyValue selected={false} onClick={() => onPick("empty")}>
          Không có
        </PickerItem>
      ) : null}
      <PickerItem selected onClick={() => onPick("done")}>
        Hoàn thành
      </PickerItem>
    </PropertyPicker>
  );
}

describe("PropertyPicker", () => {
  it("exposes selected state and supports keyboard selection after filtering", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    expect(screen.getByRole("button", { name: "Hoàn thành" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const search = screen.getByRole("textbox", { name: "Tìm giá trị…" });
    fireEvent.change(search, { target: { value: "done" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("done");
  });

  it("ignores Enter while an IME composition is active", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    const search = screen.getByRole("textbox", { name: "Tìm giá trị…" });
    fireEvent.change(search, { target: { value: "done" } });
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(onPick).not.toHaveBeenCalled();
  });
});
