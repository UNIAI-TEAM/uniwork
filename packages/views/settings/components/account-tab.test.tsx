import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { AccountTab } from "./account-tab";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

initI18n();

const user = {
  id: "u1",
  email: "lan@uni.vn",
  display_name: "Nguyễn Thị Lan",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
};

function fileInput() {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("AccountTab", () => {
  it("shows the email as text and two-letter initials, with one tab heading", () => {
    render(wrap(<AccountTab />));
    expect(screen.getAllByRole("heading", { name: "Hồ sơ" })).toHaveLength(1);
    expect(screen.getByText("lan@uni.vn").tagName).not.toBe("INPUT");
    expect(screen.queryByDisplayValue("lan@uni.vn")).toBeNull();
    expect(screen.getByText("NL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đổi ảnh" })).toBeInTheDocument();
  });

  it("saves the display name with an inline state and no success toast", async () => {
    requestMock.mockImplementation((_path: string, init?: { body?: { display_name?: string } }) =>
      Promise.resolve({ user: { ...user, display_name: init?.body?.display_name ?? user.display_name } }),
    );
    render(wrap(<AccountTab />));
    const name = screen.getByLabelText("Tên hiển thị");
    fireEvent.change(name, { target: { value: "Lan Nguyễn" } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me", expect.objectContaining({ method: "PATCH", body: { display_name: "Lan Nguyễn" } })),
    );
    expect(await screen.findByText("Đã lưu")).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("refuses a wrong type or an oversized image before uploading", () => {
    render(wrap(<AccountTab />));
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] } });
    expect(screen.getByText("Ảnh phải là PNG, JPEG, GIF hoặc WebP.")).toBeInTheDocument();

    const big = new File([new Uint8Array((2 << 20) + 1)], "big.png", { type: "image/png" });
    fireEvent.change(fileInput(), { target: { files: [big] } });
    expect(screen.getByText("Ảnh lớn hơn 2 MB. Chọn ảnh nhỏ hơn.")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("uploads a valid image", async () => {
    requestMock.mockResolvedValue({ user: { ...user, avatar_url: "https://cdn/a.png" } });
    render(wrap(<AccountTab />));
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/avatar", expect.objectContaining({ method: "POST" })),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Đã cập nhật ảnh đại diện"));
  });
});
