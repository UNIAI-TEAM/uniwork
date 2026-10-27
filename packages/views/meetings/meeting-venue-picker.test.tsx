import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeetingVenuePicker } from "./meeting-venue-picker";

describe("MeetingVenuePicker", () => {
  it("offers Online and Trực tiếp as one radio group and reports a click", () => {
    const onChange = vi.fn();
    render(<MeetingVenuePicker value="online" onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Hình thức" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Online/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Trực tiếp/ })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: /Trực tiếp/ }));
    expect(onChange).toHaveBeenCalledWith("in_person");
  });

  it("moves the choice with the arrow keys", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MeetingVenuePicker value="online" onChange={onChange} />);
    const online = screen.getByRole("radio", { name: /Online/ });
    online.focus();
    fireEvent.keyDown(online, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("in_person");
    rerender(<MeetingVenuePicker value="in_person" onChange={onChange} />);
    const inPerson = screen.getByRole("radio", { name: /Trực tiếp/ });
    inPerson.focus();
    fireEvent.keyDown(inPerson, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("online");
  });

  it("read-only keeps both in view but refuses a change", () => {
    const onChange = vi.fn();
    render(<MeetingVenuePicker value="in_person" onChange={onChange} readOnly />);
    const online = screen.getByRole("radio", { name: /Online/ });
    expect(online).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(online);
    expect(onChange).not.toHaveBeenCalled();
  });
});
