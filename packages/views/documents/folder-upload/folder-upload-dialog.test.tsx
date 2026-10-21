import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FolderUploadPlan } from "@uniwork/core/documents/folder-upload";
import { FolderUploadDialog, type FolderUploadDialogProps } from "./folder-upload-dialog";

const MIB = 1024 * 1024;

function plan(over: Partial<FolderUploadPlan> = {}): FolderUploadPlan {
  return {
    rootName: "Báo cáo",
    rootTitle: "Báo cáo",
    folders: ["Báo cáo", "Báo cáo/2026"],
    files: [],
    skipped: [],
    totals: { files: 40, bytes: 125.3 * MIB },
    refusal: null,
    ...over,
  };
}

function renderDialog(over: Partial<FolderUploadDialogProps> = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <FolderUploadDialog
      open
      onOpenChange={onOpenChange}
      plan={plan()}
      destinationName="Thư mục của tôi"
      onSubmit={onSubmit}
      {...over}
    />,
  );
  return { onSubmit, onOpenChange };
}

const submit = () => screen.getByRole("button", { name: "Tải lên" });

const filesPlan = (over: Partial<FolderUploadPlan> = {}) =>
  plan({ rootName: null, rootTitle: null, folders: [], totals: { files: 12, bytes: 3 * MIB }, ...over });

describe("FolderUploadDialog", () => {
  it("marks the folder mode on the dialog", () => {
    renderDialog();
    expect(screen.getByTestId("folder-upload-dialog")).toHaveAttribute("data-mode", "folder");
    expect(screen.getByRole("heading", { name: "Tải lên thư mục" })).toBeInTheDocument();
  });

  it("in files mode shows no root line, only the destination, the count and the size", () => {
    renderDialog({ plan: filesPlan() });
    expect(screen.getByTestId("folder-upload-dialog")).toHaveAttribute("data-mode", "files");
    expect(screen.getByRole("heading", { name: "Tải lên tệp" })).toBeInTheDocument();
    expect(screen.queryByTestId("folder-upload-root")).toBeNull();
    expect(screen.queryByTestId("folder-upload-renamed")).toBeNull();
    expect(screen.getByTestId("folder-upload-destination")).toHaveTextContent("Thư mục của tôi");
    expect(screen.getByTestId("folder-upload-summary")).toHaveTextContent("12 tệp · 3 MB");
    expect(screen.getByText("Áp dụng cho mọi tệp trong lần tải lên này.")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("in files mode names the refusal for the files, not a folder", () => {
    renderDialog({ plan: filesPlan({ files: [], totals: { files: 0, bytes: 0 }, refusal: { code: "nothing_to_upload" } }) });
    const refusal = screen.getByTestId("folder-upload-refusal");
    expect(refusal).toHaveTextContent("Chưa tải lên được các tệp này");
    expect(refusal).toHaveTextContent("Không có tệp nào tải lên được.");
    expect(refusal).not.toHaveTextContent("thư mục");
  });

  it("in files mode sends the share switch for every file of the run", () => {
    const { onSubmit } = renderDialog({ plan: filesPlan() });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenCalledWith({ shareWithWorkspace: true });
  });

  it("shows the root, the destination and the file count with the size", () => {
    renderDialog();
    expect(screen.getByTestId("folder-upload-root")).toHaveTextContent("Báo cáo");
    expect(screen.getByTestId("folder-upload-destination")).toHaveTextContent("Thư mục của tôi");
    expect(screen.getByTestId("folder-upload-summary")).toHaveTextContent("40 tệp · 125,3 MB");
    expect(screen.queryByTestId("folder-upload-renamed")).toBeNull();
  });

  it("names the (n) title when the root name is taken", () => {
    renderDialog({ plan: plan({ rootTitle: "Báo cáo (1)" }) });
    expect(screen.getByTestId("folder-upload-root")).toHaveTextContent("Báo cáo (1)");
    expect(screen.getByTestId("folder-upload-renamed")).toHaveTextContent("Đã có «Báo cáo» ở đây");
    expect(screen.getByTestId("folder-upload-renamed")).toHaveTextContent("«Báo cáo (1)»");
  });

  it("groups skipped files by reason and expands the paths of one group", () => {
    renderDialog({
      plan: plan({
        skipped: [
          { path: "Báo cáo/.DS_Store", reason: "hidden" },
          { path: "Báo cáo/~$a.docx", reason: "hidden" },
          { path: "Báo cáo/phim.mp4", reason: "unsupported_format" },
        ],
      }),
    });
    expect(screen.getByRole("heading", { name: "Bỏ qua 3 tệp" })).toBeInTheDocument();
    expect(screen.getByText("Tệp ẩn hoặc tệp hệ thống · 2")).toBeInTheDocument();
    expect(screen.getByText("Định dạng chưa được hỗ trợ · 1")).toBeInTheDocument();
    expect(screen.queryByText("Báo cáo/.DS_Store")).toBeNull();

    const toggles = screen.getAllByRole("button", { name: "Xem danh sách" });
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggles[0] as HTMLElement);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Báo cáo/.DS_Store")).toBeInTheDocument();
    expect(screen.getByText("Báo cáo/~$a.docx")).toBeInTheDocument();
    expect(screen.queryByText("Báo cáo/phim.mp4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ẩn danh sách" }));
    expect(screen.queryByText("Báo cáo/.DS_Store")).toBeNull();
  });

  it("refuses with the numbers and keeps Upload aria-disabled", () => {
    const { onSubmit } = renderDialog({
      plan: plan({ refusal: { code: "too_many_files", limit: 500, actual: 612 } }),
    });
    const alert = screen.getByTestId("folder-upload-refusal");
    expect(within(alert).getByText("612 tệp — tối đa 500")).toBeInTheDocument();
    expect(screen.queryByTestId("folder-upload-summary")).toBeNull();
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("writes the size and depth refusals with their units", () => {
    const { rerender } = render(
      <FolderUploadDialog
        open
        onOpenChange={() => undefined}
        plan={plan({ refusal: { code: "too_large_total", limit: 2 * 1024 ** 3, actual: 2.4 * 1024 ** 3 } })}
        destinationName="x"
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByText("2,4 GB — tối đa 2 GB")).toBeInTheDocument();
    rerender(
      <FolderUploadDialog
        open
        onOpenChange={() => undefined}
        plan={plan({ refusal: { code: "too_deep", limit: 20, actual: 23 } })}
        destinationName="x"
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByText("Sâu 23 cấp — tối đa 20")).toBeInTheDocument();
  });

  it("starts with sharing off and sends it only after the switch is turned on", () => {
    const { onSubmit } = renderDialog();
    const toggle = screen.getByRole("switch", { name: "Chia sẻ với workspace" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Áp dụng cho mọi tệp trong lần tải lên này/)).toBeInTheDocument();
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenLastCalledWith({ shareWithWorkspace: false });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenLastCalledWith({ shareWithWorkspace: true });
  });

  it("shows the inherited state and does not send a share flag when the destination is shared", () => {
    const { onSubmit } = renderDialog({ parentShared: true });
    const toggle = screen.getByRole("switch", { name: "Chia sẻ với workspace" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/đang chia sẻ với workspace nên các tệp cũng vậy/)).toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenCalledWith({ shareWithWorkspace: false });
  });

  it("cancels without submitting and blocks closing while the run is being prepared", () => {
    const { onSubmit, onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("tells how many folders still wait behind this one", () => {
    renderDialog({ queued: 2 });
    expect(screen.getByText("Còn 2 thư mục đang chờ.")).toBeInTheDocument();
  });

  it("says the server is busy while the run waits out Retry-After", () => {
    renderDialog({ pending: true, waiting: true });
    expect(screen.getByRole("status")).toHaveTextContent("Máy chủ đang bận, sẽ tự thử lại sau ít giây…");
  });

  it("keeps Hủy live while the run waits, so the run can be canceled", () => {
    const { onOpenChange } = renderDialog({ pending: true, waiting: true });
    const cancel = screen.getByRole("button", { name: "Hủy" });
    expect(cancel).not.toBeDisabled();
    fireEvent.click(cancel);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("names the folder count of a too_many_folders refusal", () => {
    renderDialog({ plan: plan({ refusal: { code: "too_many_folders", limit: 500, actual: 530 } as never }) });
    expect(screen.getByTestId("folder-upload-refusal")).toHaveTextContent("530 thư mục — tối đa 500");
  });
});
