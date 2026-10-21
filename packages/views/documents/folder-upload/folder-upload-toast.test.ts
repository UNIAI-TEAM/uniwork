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

  it("uses the server's title for the end state, not the preview name", () => {
    const { handle } = make();
    handle.settle(settled({ title: "Báo cáo (1)" }));
    expect(toast.success.mock.calls[0]?.[0]).toBe("Đã tải lên 40 tệp vào «Báo cáo (1)»");
  });

  it("dismisses its own toast", () => {
    const { handle } = make();
    handle.dismiss();
    expect(toast.dismiss).toHaveBeenCalledWith(toast.loading.mock.calls[0]?.[1].id);
  });
});
