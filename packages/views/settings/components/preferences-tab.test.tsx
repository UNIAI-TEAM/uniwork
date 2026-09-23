import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { requestMock, wrap } from "../../test/api-mock";
import { PreferencesTab } from "./preferences-tab";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

initI18n();

const user = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
  timezone: "Asia/Ho_Chi_Minh",
};

function renderTab() {
  return render(
    wrap(
      <ThemeProvider>
        <PreferencesTab />
      </ThemeProvider>,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("PreferencesTab", () => {
  it("gives each group one heading and says where each setting is kept", () => {
    renderTab();
    expect(screen.getByRole("group", { name: "Chế độ hiển thị" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Màu nhấn" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Giao diện" })).toBeNull();
    expect(screen.getByText(/Chỉ lưu trên trình duyệt này/)).toBeInTheDocument();
    expect(screen.getByText(/Lưu theo tài khoản/)).toBeInTheDocument();
  });

  it("shows the time zone with its UTC offset and saves a searched one inline, without a toast", async () => {
    requestMock.mockImplementation((_path: string, init?: { body?: { timezone?: string } }) =>
      Promise.resolve({ user: { ...user, timezone: init?.body?.timezone ?? user.timezone } }),
    );
    renderTab();
    const input = screen.getByRole("combobox", { name: "Múi giờ" });
    expect(input).toHaveValue("(UTC+07:00) Hồ Chí Minh · Giờ Đông Dương");

    fireEvent.change(input, { target: { value: "Tokyo" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const list = await screen.findByRole("listbox");
    fireEvent.click(within(list).getByText("(UTC+09:00) Tokyo · Giờ Chuẩn Nhật Bản"));

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me", expect.objectContaining({ method: "PATCH", body: { timezone: "Asia/Tokyo" } })),
    );
    expect(await screen.findByText("Đã lưu")).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("finds Vietnam's zone from an unaccented city it does not name", async () => {
    renderTab();
    const input = screen.getByRole("combobox", { name: "Múi giờ" });
    fireEvent.change(input, { target: { value: "ha noi" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const list = await screen.findByRole("listbox");
    expect(within(list).getByText("(UTC+07:00) Hồ Chí Minh · Giờ Đông Dương")).toBeInTheDocument();
  });

  it("reports a refused time zone inline only and shows the saved zone again", async () => {
    requestMock.mockRejectedValue(new ApiError("boom", "internal", 500));
    renderTab();
    const input = screen.getByRole("combobox", { name: "Múi giờ" });
    fireEvent.change(input, { target: { value: "Tokyo" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.click(within(await screen.findByRole("listbox")).getByText("(UTC+09:00) Tokyo · Giờ Chuẩn Nhật Bản"));

    expect(await screen.findByText("Không lưu được")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    await waitFor(() => expect(input).toHaveValue("(UTC+07:00) Hồ Chí Minh · Giờ Đông Dương"));
  });

  it("gives the language select the same height as the time zone field", () => {
    renderTab();
    expect(screen.getByRole("combobox", { name: "Ngôn ngữ" })).toHaveAttribute("data-size", "default");
  });
});
