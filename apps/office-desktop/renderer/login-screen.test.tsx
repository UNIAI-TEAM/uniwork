/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginScreen, type LoginScreenProps } from "./login-screen";

const STATES: LoginScreenProps["state"][] = ["signed-out", "pending", "error", "cancelled", "signed-in", "locked", "login-required"];

describe("LoginScreen", () => {
  it.each(STATES)("renders the %s state with the wordmark and no raw-text fallback", (state) => {
    render(<LoginScreen state={state} onStart={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByText("UniWork Office")).toBeInTheDocument();
    expect(screen.getByRole(state === "pending" ? "button" : "button")).toBeInTheDocument();
  });

  it("shows Start and calls onStart when not pending", () => {
    const onStart = vi.fn();
    render(<LoginScreen state="signed-out" onStart={onStart} onCancel={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("offers sign-in and one local entry with their captions", () => {
    const onUseLocal = vi.fn();
    render(<LoginScreen state="signed-out" onStart={() => undefined} onCancel={() => undefined} onUseLocal={onUseLocal} />);
    expect(screen.getByText("Đăng nhập để mở và lưu tài liệu trong thư viện UniWork.")).toBeInTheDocument();
    expect(screen.getByText("Trang đăng nhập sẽ mở trong trình duyệt.")).toBeInTheDocument();
    expect(screen.getByText("hoặc")).toBeInTheDocument();
    expect(screen.getByText("Không cần đăng nhập. Tệp chỉ lưu trên máy này, bạn có thể đăng nhập bất cứ lúc nào.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Mở tệp trên máy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Làm việc với tệp trên máy" }));
    expect(onUseLocal).toHaveBeenCalledOnce();
  });

  it("hides the local entry while sign-in is pending", () => {
    render(<LoginScreen state="pending" onStart={() => undefined} onCancel={() => undefined} onUseLocal={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Làm việc với tệp trên máy" })).toBeNull();
    expect(screen.getByText("Tiếp tục đăng nhập trong trình duyệt để hoàn tất.")).toBeInTheDocument();
  });

  it("shows Cancel and calls onCancel while pending", () => {
    const onCancel = vi.fn();
    render(<LoginScreen state="pending" onStart={() => undefined} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Hủy đăng nhập" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the start action once signed in", () => {
    render(<LoginScreen state="signed-in" onStart={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeDisabled();
  });

  it("carries the state as a data attribute for host-level checks", () => {
    const { container } = render(<LoginScreen state="locked" onStart={() => undefined} onCancel={() => undefined} />);
    expect(container.querySelector("[data-login-state='locked']")).not.toBeNull();
  });

  it("shows the keyring fix hint when the locked store names that cause", () => {
    render(<LoginScreen state="locked" lockedReason="keyring" onStart={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByText("UniWork Office cần gnome-keyring (libsecret) để lưu đăng nhập. Hãy cài đặt và mở khóa rồi thử lại.")).toBeInTheDocument();
  });

  it("keeps the generic locked copy when the reason is unknown", () => {
    render(<LoginScreen state="locked" onStart={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByText("Kho lưu trữ thông tin đăng nhập đang bị khóa. Mở khóa và thử lại.")).toBeInTheDocument();
  });
});
