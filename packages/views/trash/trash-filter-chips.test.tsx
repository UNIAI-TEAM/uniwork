import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TRASH_MAX_DELETERS } from "@uniwork/core/trash";
import { KindFilter, PeopleFilter } from "./trash-filter-chips";

const me = { user_id: "me", display_name: "An" };

describe("PeopleFilter", () => {
  it("locks the unticked rows once the server's cap is picked, keeping them focusable", async () => {
    const others = Array.from({ length: TRASH_MAX_DELETERS }, (_, i) => ({ user_id: `u${i}`, display_name: `Người ${i}` }));
    const onChange = vi.fn();
    render(<PeopleFilter trashedBy={others.map((m) => m.user_id)} members={[me, ...others]} meId="me" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^Người xóa/ }));

    const locked = await screen.findByRole("checkbox", { name: "Tôi" });
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveAccessibleDescription(`Chọn được tối đa ${TRASH_MAX_DELETERS} người`);
    locked.focus();
    expect(locked).toHaveFocus();
    fireEvent.click(locked);
    expect(onChange).not.toHaveBeenCalled();

    const picked = screen.getByRole("checkbox", { name: "Người 0" });
    expect(picked).not.toHaveAttribute("aria-disabled");
    fireEvent.click(picked);
    expect(onChange).toHaveBeenCalledWith(others.slice(1).map((m) => m.user_id));
  });

  it("names people who left the workspace once, however many are picked", () => {
    const { rerender } = render(<PeopleFilter trashedBy={["gone1"]} members={[me]} meId="me" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Người xóa: Thành viên cũ" })).toBeInTheDocument();
    rerender(<PeopleFilter trashedBy={["me", "gone1", "gone2"]} members={[me]} meId="me" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Người xóa: Tôi, 2 thành viên cũ" })).toBeInTheDocument();
  });
});

describe("filter chip", () => {
  it("traces the chip's border with the focus outline, on the opener and the ×", () => {
    render(<KindFilter kinds={["task"]} options={["task", "project"]} onChange={() => {}} />);
    for (const name of ["Loại: Công việc", "Bỏ lọc Loại"]) {
      const part = screen.getByRole("button", { name });
      expect(part.className).toContain("focus-visible:outline-offset-0");
      expect(part.className).not.toContain("outline-none");
    }
  });
});
