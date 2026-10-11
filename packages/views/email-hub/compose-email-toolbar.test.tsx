import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposeEmailToolbar, type ComposeDraftAttachment } from "./compose-email-toolbar";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));

const MiB = 1024 * 1024;

function fileOf(name: string, size: number): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("ComposeEmailToolbar attachments", () => {
  it("refuses a file that would push the total past 15 MB", () => {
    const onAttachmentsChange = vi.fn<(a: ComposeDraftAttachment[]) => void>();
    const { container } = render(
      <ComposeEmailToolbar
        bodyRef={createRef<HTMLTextAreaElement>()}
        body=""
        onBodyChange={vi.fn()}
        fromEmail="me@example.com"
        to=""
        cc=""
        subject=""
        attachments={[]}
        onAttachmentsChange={onAttachmentsChange}
        canSend
        sendBlockedReason={null}
        sending={false}
        onSend={vi.fn()}
        onScheduleSend={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const files = ["a.pdf", "b.pdf", "c.pdf", "d.pdf"].map((name) => fileOf(name, 5 * MiB));
    fireEvent.change(input, { target: { files } });

    const kept = onAttachmentsChange.mock.calls[0]?.[0] ?? [];
    expect(kept.map((a) => a.file.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(toastError).toHaveBeenCalledWith("d.pdf vượt tổng dung lượng 15 MB.");
  });
});
