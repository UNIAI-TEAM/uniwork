import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfImageInsertPanel } from "./image-insert-panel";
import type { PdfImageOperationProvider } from "./types";

function provider(): PdfImageOperationProvider { return { insertImage: vi.fn(), transformImage: vi.fn(), replaceImage: vi.fn(), deleteImage: vi.fn() }; }

describe("PdfImageInsertPanel", () => {
  it("reads a selected file and submits a typed insert image request", async () => {
    const host = provider();
    render(<PdfImageInsertPanel page={2} provider={host} />);
    const file = new File([Uint8Array.from([1, 2, 3])], "stamp.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Insert image"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Insert image" }));
    await waitFor(() => expect(host.insertImage).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 1, layer: "aboveText", image: expect.any(Uint8Array) })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
