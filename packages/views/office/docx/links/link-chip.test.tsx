import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkChip, type LinkChipProps } from "./link-chip";

const HREF = "https://uniwork.vn/page";

function renderChip(overrides: Partial<LinkChipProps> = {}) {
  const props: LinkChipProps = {
    href: HREF,
    onOpen: vi.fn(),
    onCopy: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(<LinkChip {...props} />);
  return props;
}

describe("LinkChip", () => {
  it("shows the URL and calls each action with the href", () => {
    const props = renderChip();
    expect(screen.getByTestId("docx-link-chip-href")).toHaveTextContent(HREF);
    fireEvent.click(screen.getByRole("button", { name: "Mở liên kết" }));
    expect(props.onOpen).toHaveBeenCalledWith(HREF);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép liên kết" }));
    expect(props.onCopy).toHaveBeenCalledWith(HREF);
    fireEvent.click(screen.getByRole("button", { name: "Sửa liên kết" }));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Bỏ liên kết" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps Open and Copy live while Edit and Remove disable on a read-only document", () => {
    const props = renderChip({ readOnly: true });
    expect(screen.getByRole("button", { name: "Mở liên kết" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sao chép liên kết" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sửa liên kết" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bỏ liên kết" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Mở liên kết" }));
    expect(props.onOpen).toHaveBeenCalledWith(HREF);
  });
});
