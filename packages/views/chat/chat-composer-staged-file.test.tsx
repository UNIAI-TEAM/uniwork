import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { StagedFileChip } from "./chat-composer-parts";

initI18n();

describe("StagedFileChip", () => {
  it("opens the image preview dialog when the thumbnail is pressed", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:staged-image");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const file = new File([new Uint8Array([1, 2, 3])], "beach.jpg", { type: "image/jpeg" });

    render(<StagedFileChip file={file} onRemove={() => {}} />);

    fireEvent.click(screen.getAllByRole("button", { name: /Xem beach\.jpg/i })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByRole("img", { name: "beach.jpg" })).toHaveAttribute("src", "blob:staged-image");

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});
