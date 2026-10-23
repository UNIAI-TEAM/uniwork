import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { ApiError } from "@uniwork/core/api/http";
import { deleteAskAttachment, uploadAskAttachment } from "@uniwork/core/api/endpoints/ai-attachments";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { AskUploadedFile } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, requestStreamMock, streamResponse, wrapWithNav } from "../test/api-mock";
import { capabilities, composerRoutes, user, workspace } from "./ask-uni-fixtures";
import { AskUniAttachmentChip } from "./ask-uni-attachment-chip";
import { AskUniPanel } from "./ask-uni-panel";

vi.mock("@uniwork/core/api/endpoints/ai-attachments", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/ai-attachments")>()),
  uploadAskAttachment: vi.fn(),
  deleteAskAttachment: vi.fn(),
}));

initI18n();

type Surface = HTMLElement & { editor: Editor };
const box = () => screen.getByLabelText("Câu hỏi cho UNI") as Surface;

interface Upload {
  file: File;
  onProgress: (loaded: number, total: number) => void;
  resolve: (r?: Partial<AskUploadedFile>) => void;
  reject: (e: unknown) => void;
}
let uploads: Upload[];

/** A file of `size` bytes without allocating them. */
function f(name: string, type = "application/pdf", size = 2048): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

let attachmentsOn: boolean;

beforeEach(() => {
  uploads = [];
  attachmentsOn = true;
  vi.mocked(uploadAskAttachment).mockImplementation(
    (_ws, file, opts) =>
      new Promise<AskUploadedFile>((resolve, reject) => {
        uploads.push({
          file,
          onProgress: opts!.onProgress!,
          resolve: (r) => resolve({ file_id: `id-${file.name}`, name: file.name, mime: file.type, size: file.size, kind: "pdf", ...r }),
          reject,
        });
      }),
  );
  vi.mocked(deleteAskAttachment).mockResolvedValue(undefined);
  requestMock.mockReset();
  requestStreamMock.mockReset();
  requestStreamMock.mockImplementation((..._args: unknown[]) => Promise.resolve(streamResponse([])) as never);
  requestMock.mockImplementation((path: string, init?: never) => {
    if (path.endsWith("/ai/capabilities")) return Promise.resolve({ ...capabilities(), attachments: attachmentsOn });
    if (path.endsWith("/ai/conversations")) return Promise.resolve({ conversations: [] });
    return composerRoutes(path, init);
  });
  useAiPanelStore.setState({ conversationId: null, workspaceId: "ws1", page: null, pageDismissed: null, pendingFocus: null, focus: null });
  useAskModelChoice.setState({ model: "", effort: "" });
  resetAuthStoreForTests();
  setSessionUser(user);
});
afterEach(() => vi.clearAllMocks());

function mount() {
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniPanel />
      </WorkspaceProvider>,
    ),
  );
}

/** The panel with the capabilities answered, so the attach entry points exist (or, when off, are known to stay away). */
async function mounted() {
  mount();
  await screen.findByLabelText("Câu hỏi cho UNI");
  await waitFor(() => expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/ai/capabilities"))).toBe(true));
  await act(async () => {});
  return document.querySelector<HTMLElement>('[data-slot="ask-uni-panel"]')!;
}

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]');
const sendButton = () => screen.getByRole("button", { name: "Gửi" });

/** Picks files through the "+" menu's hidden input. */
function pick(...files: File[]) {
  act(() => {
    fireEvent.change(fileInput()!, { target: { files } });
  });
}

function type(text: string) {
  const { editor } = box();
  act(() => {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (fn) =>
        fn(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
}

const enter = () => fireEvent.keyDown(box(), { key: "Enter" });

function paste(data: { text?: string; files?: File[] }) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: data.files ?? [], types: data.text ? ["text/plain"] : ["Files"], getData: (k: string) => (k === "text/plain" ? data.text ?? "" : "") },
  });
  act(() => {
    box().dispatchEvent(event);
  });
}

const askBody = () => {
  const call = requestStreamMock.mock.calls.find(([p]) => String(p).endsWith("/ai/ask/stream"));
  return (call?.[1] as { body?: { question: string; attachment_ids?: string[] } } | undefined)?.body;
};

describe("attaching files to an Ask UNI question", () => {
  it("offers Upload files at the bottom of + only when attachments are available", async () => {
    await mounted();
    fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
    const upload = await screen.findByRole("button", { name: /Tải file lên/ });
    expect(upload).toHaveTextContent("hoặc kéo thả");
    // After the search box and the object list: the last row of the menu.
    const search = screen.getByRole("combobox", { name: /Tìm/ });
    expect(search.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(upload.closest('[data-slot="popover-content"]')!.lastElementChild).toBe(upload);
    expect(fileInput()).toHaveAttribute("multiple");
    expect(fileInput()!.accept).toContain(".pdf");
    expect(fileInput()!.accept).not.toContain(".doc,");
  });

  it("is exactly the composer it was when attachments are off", async () => {
    attachmentsOn = false;
    const panel = await mounted();
    fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
    await screen.findByRole("combobox", { name: /Tìm/ });
    expect(screen.queryByText("Tải file lên")).toBeNull();
    expect(fileInput()).toBeNull();
    // No overlay for a dragged file, and a dropped one attaches nothing.
    fireEvent.dragEnter(panel, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.queryByText("Thả để gắn vào câu hỏi")).toBeNull();
    fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files: [f("a.pdf")] } });
    paste({ files: [f("a.png", "image/png")] });
    expect(uploads).toHaveLength(0);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows a chip with progress for a picked file and sends its id", async () => {
    await mounted();
    fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
    fireEvent.click(await screen.findByRole("button", { name: /Tải file lên/ }));
    pick(f("bao-cao.pdf"));
    const chip = (await screen.findByText("bao-cao.pdf")).closest('[data-slot="ask-uni-attachment"]') as HTMLElement;
    // The menu closes behind a pick.
    expect(screen.queryByRole("combobox", { name: /Tìm/ })).toBeNull();
    const bar = within(chip).getByRole("progressbar", { name: "Đang tải lên: bao-cao.pdf" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    act(() => uploads[0]!.onProgress(5, 10));
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    await act(async () => uploads[0]!.resolve());
    expect(within(chip).queryByRole("progressbar")).toBeNull();
    expect(chip).toHaveTextContent("2 KB");

    type("Tóm tắt file này");
    enter();
    await vi.waitFor(() => expect(askBody()).toBeDefined());
    expect(askBody()).toMatchObject({ question: "Tóm tắt file này", attachment_ids: ["id-bao-cao.pdf"] });
    // The files belong to the sent question: the row is empty again, and nothing is cancelled.
    expect(document.querySelector('[data-slot="ask-uni-composer"] [data-slot="ask-uni-attachment"]')).toBeNull();
    expect(deleteAskAttachment).not.toHaveBeenCalled();
  });

  it("removes a chip with its x, cancelling the upload that was stored", async () => {
    await mounted();
    pick(f("a.pdf"), f("b.pdf"));
    await act(async () => uploads[0]!.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Bỏ a.pdf" }));
    expect(screen.queryByText("a.pdf")).toBeNull();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
    expect(deleteAskAttachment).toHaveBeenCalledWith("ws1", "id-a.pdf");
  });

  it("keeps Send disabled while a file uploads or has failed", async () => {
    await mounted();
    pick(f("a.pdf"));
    type("Câu hỏi");
    expect(sendButton()).toHaveAttribute("aria-disabled", "true");
    enter();
    expect(askBody()).toBeUndefined();
    // The text stays for when the file is ready.
    expect(box().editor.getText()).toBe("Câu hỏi");

    await act(async () => uploads[0]!.reject(new ApiError("x", "internal", 500)));
    const chip = screen.getByText("a.pdf").closest('[data-slot="ask-uni-attachment"]') as HTMLElement;
    expect(chip).toHaveAttribute("data-status", "error");
    expect(chip).toHaveTextContent("Tải lên không được");
    expect(sendButton()).toHaveAttribute("aria-disabled", "true");
    enter();
    expect(askBody()).toBeUndefined();

    fireEvent.click(within(chip).getByRole("button", { name: "Thử lại" }));
    expect(uploads).toHaveLength(2);
    expect(chip).toHaveAttribute("data-status", "uploading");
    await act(async () => uploads[1]!.resolve());
    expect(sendButton()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(sendButton());
    await vi.waitFor(() => expect(askBody()).toMatchObject({ question: "Câu hỏi", attachment_ids: ["id-a.pdf"] }));
  });

  it("names a known upload refusal and falls back to the general one for any other", async () => {
    await mounted();
    pick(f("a.pdf"), f("b.pdf"), f("c.pdf"), f("d.pdf"));
    await act(async () => {
      uploads[0]!.reject(new ApiError("big", "too_large", 413));
      uploads[1]!.reject(new ApiError("big", "file_too_large", 413));
      uploads[2]!.reject(new ApiError("type", "file_type_rejected", 415));
      uploads[3]!.reject(new ApiError("off", "ai_attachments_unavailable", 403));
    });
    const text = (name: string) => screen.getByText(name).closest('[data-slot="ask-uni-attachment"]')!.textContent;
    expect(text("a.pdf")).toContain("File lớn hơn 20 MB");
    expect(text("b.pdf")).toContain("File lớn hơn 20 MB");
    expect(text("c.pdf")).toContain("UNI chưa đọc được loại file này");
    expect(text("d.pdf")).toContain("Tải lên không được");
  });

  it("dropping files on the dock attaches them", async () => {
    const panel = await mounted();
    expect(screen.queryByText("Thả để gắn vào câu hỏi")).toBeNull();
    fireEvent.dragEnter(panel, { dataTransfer: { types: ["Files"], files: [] } });
    const overlay = screen.getByText("Thả để gắn vào câu hỏi");
    // The overlay covers the dock and never takes the drop itself.
    expect(panel).toContainElement(overlay);
    expect(overlay.closest("[class*='pointer-events-none']")).not.toBeNull();
    fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files: [f("a.pdf"), f("b.png", "image/png")] } });
    expect(screen.queryByText("Thả để gắn vào câu hỏi")).toBeNull();
    expect(await screen.findByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
    expect(uploads.map((u) => u.file.name)).toEqual(["a.pdf", "b.png"]);
  });

  it("a drag that carries no file shows no overlay", async () => {
    const panel = await mounted();
    fireEvent.dragEnter(panel, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(screen.queryByText("Thả để gắn vào câu hỏi")).toBeNull();
  });

  it("pasting an image attaches it and pasting text still inserts text", async () => {
    await mounted();
    paste({ files: [f("anh.png", "image/png"), f("ghi-chu.pdf")] });
    expect(await screen.findByText("anh.png")).toBeInTheDocument();
    // Only images come in by paste; the + menu is the way for the rest.
    expect(screen.queryByText("ghi-chu.pdf")).toBeNull();
    expect(box().editor.getText()).toBe("");
    expect(uploads.map((u) => u.file.name)).toEqual(["anh.png"]);

    paste({ text: "Hỏi\nngay" });
    expect(box().editor.getText()).toBe("Hỏi\nngay");
    expect(uploads).toHaveLength(1);
  });

  it("pasting a table copied from a spreadsheet inserts its text, not its picture", async () => {
    await mounted();
    paste({ text: "a\tb", files: [f("image.png", "image/png")] });
    expect(box().editor.getText()).toBe("a\tb");
    expect(uploads).toHaveLength(0);
  });

  it("explains why a file was refused at the chip row", async () => {
    await mounted();
    pick(f("big1.pdf", "application/pdf", 21 * 1024 * 1024), f("big2.pdf", "application/pdf", 22 * 1024 * 1024), f("old.doc", "application/msword"));
    const alerts = await screen.findAllByRole("alert");
    // Each distinct reason once, however many files hit it.
    expect(alerts.map((a) => a.textContent).sort()).toEqual(["File lớn hơn 20 MB", "UNI chưa đọc được loại file này"]);
    expect(uploads).toHaveLength(0);

    // A new pick replaces the notice; a sixth file is told about the limit.
    pick(f("1.pdf"), f("2.pdf"), f("3.pdf"), f("4.pdf"), f("5.pdf"), f("6.pdf"));
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent)).toEqual(["Tối đa 5 file mỗi câu hỏi"]);
    expect(uploads).toHaveLength(5);

    // The total of the files together is its own reason.
    for (const u of uploads) await act(async () => u.resolve());
    for (const name of ["1.pdf", "2.pdf", "3.pdf", "4.pdf"]) fireEvent.click(screen.getByRole("button", { name: `Bỏ ${name}` }));
    pick(f("m.pdf", "application/pdf", 20 * 1024 * 1024));
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent)).toEqual(["Tổng dung lượng quá 20 MB"]);
  });
});

describe("AskUniAttachmentChip", () => {
  it("draws an image with the image icon and any other file by its type", () => {
    const { rerender } = render(<AskUniAttachmentChip name="anh.png" size={1024} mime="image/png" status="ready" />);
    expect(document.querySelector(".lucide-image")).not.toBeNull();
    rerender(<AskUniAttachmentChip name="bao-cao.pdf" size={1024} mime="application/pdf" status="ready" />);
    expect(document.querySelector(".lucide-image")).toBeNull();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
  });

  it("is a plain label without handlers, and one button for name and size when it can open", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<AskUniAttachmentChip name="a.pdf" size={10} mime="application/pdf" status="ready" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<AskUniAttachmentChip name="a.pdf" size={10} mime="application/pdf" status="ready" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /a\.pdf/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says the upload failed when no reason is given, and offers retry only for a failure", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<AskUniAttachmentChip name="a.pdf" size={10} mime="application/pdf" status="error" onRetry={onRetry} />);
    expect(screen.getByText("Tải lên không được")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<AskUniAttachmentChip name="a.pdf" size={10} mime="application/pdf" status="ready" onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
  });
});
