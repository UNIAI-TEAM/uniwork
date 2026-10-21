import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { createFolderUploadToast } from "./folder-upload-toast";

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

beforeEach(() => {
  for (const fn of Object.values(toast)) fn.mockReset();
});

function make() {
  const onCancelAll = vi.fn();
  const handle = createFolderUploadToast({ t, name: "Báo cáo", total: 40, onCancelAll });
  return { handle, onCancelAll };
}

const settled = (over: Partial<Parameters<ReturnType<typeof make>["handle"]["settle"]>[0]> = {}) => ({
  title: "Báo cáo",
  total: 40,
  done: 40,
  failed: 0,
  canceled: false,
  onOpenFolder: vi.fn(),
  onViewFailures: vi.fn(),
  ...over,
});

describe("createFolderUploadToast in files mode (ADDENDUM 2 A7)", () => {
  function makeFiles(retry = false) {
    return createFolderUploadToast({ t, name: "Hợp đồng", total: 40, onCancelAll: vi.fn(), mode: "files", retry });
  }

  it("shows progress with no folder name and Hủy tất cả", () => {
    makeFiles().progress({ done: 12, total: 40 });
    const call = toast.loading.mock.calls.at(-1);
    expect(call?.[0]).toBe("Đang tải lên — 12/40 tệp");
    expect(call?.[1].action.label).toBe("Hủy tất cả");
  });

  it("names the destination on success and opens it", () => {
    const onOpenFolder = vi.fn();
    makeFiles().settle(settled({ title: "Hợp đồng", onOpenFolder }));
    const [message, options] = toast.success.mock.calls[0] ?? [];
    expect(message).toBe("Đã tải lên 40 tệp vào «Hợp đồng»");
    expect(options.action.label).toBe("Mở thư mục");
    options.action.onClick();
    expect(onOpenFolder).toHaveBeenCalledTimes(1);
  });

  it("says to upload the files again when the batch expired", () => {
    makeFiles().settle(settled({ title: "Hợp đồng", done: 10, failed: 3, expired: true }));
    expect(toast.warning.mock.calls[0]?.[0]).toBe("Lượt tải lên đã hết hạn — 10/40 tệp đã lên. Hãy tải lại tệp.");
  });

  it("keeps partial and canceled as for folders, and a retry has its own line", () => {
    makeFiles().settle(settled({ done: 37, failed: 3 }));
    expect(toast.warning.mock.calls[0]?.[0]).toBe("37/40 tệp đã tải lên · 3 lỗi");
    makeFiles().settle(settled({ done: 0, canceled: true }));
    expect(toast.info.mock.calls[0]?.[0]).toBe("Đã hủy tải lên");
    makeFiles(true).progress({ done: 38, total: 40 });
    expect(toast.loading.mock.calls.at(-1)?.[0]).toBe("Đang thử lại — 38/40 tệp");
  });
});

describe("createFolderUploadToast", () => {
  it("opens ONE progress toast with Hủy tất cả and updates the same id", () => {
    const { handle, onCancelAll } = make();
    handle.progress({ done: 12, total: 40 });

    expect(toast.loading).toHaveBeenCalledTimes(2);
    const [first, second] = toast.loading.mock.calls;
    expect(first?.[0]).toBe("Đang tải lên «Báo cáo» — 0/40 tệp");
    expect(second?.[0]).toBe("Đang tải lên «Báo cáo» — 12/40 tệp");
    expect(second?.[1].id).toBe(first?.[1].id);
    expect(second?.[1].action.label).toBe("Hủy tất cả");
    second?.[1].action.onClick();
    expect(onCancelAll).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("turns into the success toast with Mở thư mục", () => {
    const { handle } = make();
    const result = settled();
    handle.settle(result);
    const [message, options] = toast.success.mock.calls[0] ?? [];
    expect(message).toBe("Đã tải lên 40 tệp vào «Báo cáo»");
    expect(options.id).toBe(toast.loading.mock.calls[0]?.[1].id);
    expect(options.action.label).toBe("Mở thư mục");
    options.action.onClick();
    expect(result.onOpenFolder).toHaveBeenCalled();
  });

  it("names the failures on a partial run and links to the report", () => {
    const { handle } = make();
    const result = settled({ done: 38, failed: 2 });
    handle.settle(result);
    const [message, options] = toast.warning.mock.calls[0] ?? [];
    expect(message).toBe("38/40 tệp đã tải lên · 2 lỗi");
    expect(options.action.label).toBe("Xem");
    options.action.onClick();
    expect(result.onViewFailures).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says the landed files are kept after a cancel", () => {
    const { handle } = make();
    handle.settle(settled({ done: 12, canceled: true }));
    const [message, options] = toast.info.mock.calls[0] ?? [];
    expect(message).toBe("Đã hủy — 12 tệp đã tải lên được giữ lại");
    expect(options.action).toBeUndefined();
  });

  it("says an expired run has to be uploaded again and offers the report only when files failed", () => {
    const { handle } = make();
    handle.settle(settled({ done: 12, failed: 3, expired: true }));
    const [message, options] = toast.warning.mock.calls[0] ?? [];
    expect(message).toBe("Lượt tải lên «Báo cáo» đã hết hạn — 12/40 tệp đã lên. Hãy tải lại thư mục.");
    expect(options.action.label).toBe("Xem");

    handle.settle(settled({ done: 12, failed: 0, expired: true }));
    expect(toast.warning.mock.calls[1]?.[1].action).toBeUndefined();
  });

  it("uses the server's title for the end state, not the preview name", () => {
    const { handle } = make();
    handle.settle(settled({ title: "Báo cáo (1)" }));
    expect(toast.success.mock.calls[0]?.[0]).toBe("Đã tải lên 40 tệp vào «Báo cáo (1)»");
  });

  it("says a cancel kept nothing without a zero count", () => {
    const { handle } = make();
    handle.settle(settled({ done: 0, canceled: true }));
    expect(toast.info.mock.calls[0]?.[0]).toBe("Đã hủy tải lên");
  });

  it("names a retry as such, with a Cancel that stops only the retry", () => {
    const onCancelAll = vi.fn();
    createFolderUploadToast({ t, name: "Báo cáo", total: 40, onCancelAll, retry: true });
    const [message, options] = toast.loading.mock.calls[0] ?? [];
    expect(message).toBe("Đang thử lại «Báo cáo» — 0/40 tệp");
    expect(options.action.label).toBe("Hủy thử lại");
    options.action.onClick();
    expect(onCancelAll).toHaveBeenCalledTimes(1);
  });

  it("dismisses its own toast", () => {
    const { handle } = make();
    handle.dismiss();
    expect(toast.dismiss).toHaveBeenCalledWith(toast.loading.mock.calls[0]?.[1].id);
  });
});
