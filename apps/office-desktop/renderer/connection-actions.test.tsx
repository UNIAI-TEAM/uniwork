/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { ImportProfileAction, ResetConnectionAction } from "./connection-actions";
import type { DesktopDeploymentImportStatus } from "../shared/ipc";

const RESTART_REQUIRED = "Đã lưu thay đổi nhưng UniWork Office chưa khởi động lại. Bấm lại để khởi động lại, hoặc tự đóng rồi mở lại ứng dụng.";
const VI: Record<Exclude<DesktopDeploymentImportStatus, "cancelled">, string> = {
  imported: "Đang khởi động lại UniWork Office…",
  invalid: "Tệp này không phải tệp cấu hình UniWork Office. Chọn lại tệp deployment-profile.json.",
  channel_mismatch: "Tệp cấu hình này dành cho một bản UniWork Office khác. Tải lại UniWork Office từ site UniWork của bạn.",
  already_configured: "Bản UniWork Office này đã được liên kết với một site UniWork.",
  unavailable: "Không thể lưu tệp cấu hình. Thử lại.",
  restart_required: RESTART_REQUIRED,
};

describe("ImportProfileAction", () => {
  it("names the file to choose", () => {
    render(<ImportProfileAction importProfile={async () => "cancelled"} />);
    expect(screen.getByRole("button", { name: "Chọn tệp cấu hình…" })).toBeInTheDocument();
    expect(screen.getByText("Chọn tệp deployment-profile.json đi kèm bản UniWork Office bạn đã tải về.")).toBeInTheDocument();
  });

  it.each(Object.entries(VI))("shows the %s answer in Vietnamese", async (status, copy) => {
    render(<ImportProfileAction importProfile={async () => status as DesktopDeploymentImportStatus} />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn tệp cấu hình…" }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
  });

  it("says nothing on cancel and keeps the button usable", async () => {
    const importProfile = vi.fn(async (): Promise<DesktopDeploymentImportStatus> => "cancelled");
    const { container } = render(<ImportProfileAction importProfile={importProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn tệp cấu hình…" }));
    await vi.waitFor(() => expect(container.querySelector("[data-import-status='cancelled']")).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Chọn tệp cấu hình…" })).toBeEnabled();
  });

  it("keeps the button usable when the restart was refused, and asks again on the next click", async () => {
    const importProfile = vi.fn(async (): Promise<DesktopDeploymentImportStatus> => "restart_required");
    render(<ImportProfileAction importProfile={importProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn tệp cấu hình…" }));
    expect(await screen.findByRole("status")).toHaveTextContent(RESTART_REQUIRED);
    expect(screen.queryByText("Đang khởi động lại UniWork Office…")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    const button = screen.getByRole("button", { name: "Chọn tệp cấu hình…" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await vi.waitFor(() => expect(importProfile).toHaveBeenCalledTimes(2));
  });

  it("reads naturally in English and reports a rejected call as a failure", async () => {
    await setLocale("en");
    try {
      render(<ImportProfileAction importProfile={() => Promise.reject(new Error("ipc"))} />);
      fireEvent.click(screen.getByRole("button", { name: "Choose configuration file…" }));
      expect(await screen.findByText("Couldn't save the configuration file. Try again.")).toBeInTheDocument();
      expect(screen.getByText("Choose the deployment-profile.json file that came with your UniWork Office download.")).toBeInTheDocument();
    } finally {
      await setLocale("vi");
    }
  });
});

describe("ResetConnectionAction", () => {
  it("restarts on reset and reports a failure", async () => {
    const { unmount } = render(<ResetConnectionAction resetConnection={async () => "reset"} />);
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại kết nối" }));
    expect(await screen.findByText("Đang khởi động lại UniWork Office…")).toBeInTheDocument();
    unmount();
    render(<ResetConnectionAction resetConnection={async () => "unavailable"} />);
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại kết nối" }));
    expect(await screen.findByText("Không thể đặt lại kết nối. Thử lại.")).toBeInTheDocument();
  });

  it("keeps the reset button usable when the restart was refused", async () => {
    await setLocale("en");
    try {
      render(<ResetConnectionAction resetConnection={async () => "restart_required"} />);
      fireEvent.click(screen.getByRole("button", { name: "Reset connection" }));
      expect(await screen.findByText("The change is saved, but UniWork Office hasn't restarted. Click again to restart, or close and reopen the app.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reset connection" })).toBeEnabled();
    } finally {
      await setLocale("vi");
    }
  });
});
