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
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập bằng trình duyệt" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("shows Cancel and calls onCancel while pending", () => {
    const onCancel = vi.fn();
    render(<LoginScreen state="pending" onStart={() => undefined} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Hủy đăng nhập" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the start action once signed in", () => {
    render(<LoginScreen state="signed-in" onStart={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("button", { name: "Đăng nhập bằng trình duyệt" })).toBeDisabled();
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
