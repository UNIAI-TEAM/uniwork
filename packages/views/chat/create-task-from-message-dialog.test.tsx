import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  FeatureFlagService,
  FeatureFlagsProvider,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  draftAsync: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@uniwork/core/chat", () => ({
  useCreateTaskFromChatMessage: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@uniwork/core/ai", () => ({
  useAiCapabilities: () => ({ data: { enabled: true, ask_uni: true } }),
  useChatTaskDraft: () => ({
    mutateAsync: mocks.draftAsync,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

initI18n();

const defaultUser: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "Minh",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const defaultWorkspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Moon",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function renderDialog(ui: React.ReactElement) {
  const service = new FeatureFlagService(
    new StaticProvider({ drive_connector: { default: false } }),
  );
  return render(
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <WorkspaceProvider workspace={defaultWorkspace} user={defaultUser}>
          {ui}
        </WorkspaceProvider>
      </FeatureFlagsProvider>,
    ),
  );
}

const dialog = (
  <CreateTaskFromMessageDialog
    open
    onOpenChange={vi.fn()}
    workspaceId="ws1"
    messageId="m1"
    messageBody="Sửa bug login ngay hôm nay"
  />
);

describe("CreateTaskFromMessageDialog", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.draftAsync.mockReset();
    mocks.draftAsync.mockResolvedValue({
      title: "Sửa bug login ngay hôm nay",
      description: "Sửa bug login ngay hôm nay",
      priority: "none",
      due_date: "",
    });
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    requestMock.mockReset();
    requestMock.mockImplementation(async () => ({}));
  });

  it("opens the manual create composer and auto-drafts a single message", async () => {
    mocks.draftAsync.mockResolvedValue({
      title: "Sửa bug login",
      description: "Cần vá lỗi đăng nhập hôm nay.",
      priority: "high",
      due_date: "2026-10-29",
    });
    renderDialog(dialog);
    expect(screen.getByText("Tạo việc từ tin nhắn")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-property-toolbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gợi ý bằng AI/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chuyển sang agent" })).not.toBeInTheDocument();

    await waitFor(() => expect(mocks.draftAsync).toHaveBeenCalledTimes(1));
    expect(mocks.draftAsync).toHaveBeenCalledWith({
      message_ids: ["m1"],
      locale: "vi",
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Tiêu đề issue" })).toHaveValue("Sửa bug login"),
    );
    expect(screen.getByRole("button", { name: "Độ ưu tiên: Cao" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hạn/ })).toBeInTheDocument();
  });

  it("auto-drafts when opened with multiple messages", async () => {
    mocks.draftAsync.mockResolvedValue({
      title: "Hoàn thành trong chiều nay",
      description: "Làm chức năng AI cho chat trước cuối giờ chiều.",
      priority: "high",
      due_date: "2026-10-29",
    });
    renderDialog(
      <CreateTaskFromMessageDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws1"
        messageId="m3"
        messageBody="cuối giờ chiều phải hoàn thành"
        sourceMessages={[
          { id: "m1", body: "bạn hay làm chức năng ai cho chat", senderId: "u1", sentAt: 1 },
          { id: "m2", body: "hãy làm trong hôm nay", senderId: "u1", sentAt: 2 },
          { id: "m3", body: "cuối giờ chiều phải hoàn thành", senderId: "u1", sentAt: 3 },
        ]}
      />,
    );
    await waitFor(() => expect(mocks.draftAsync).toHaveBeenCalledTimes(1));
    expect(mocks.draftAsync).toHaveBeenCalledWith({
      message_ids: ["m1", "m2", "m3"],
      locale: "vi",
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Tiêu đề issue" })).toHaveValue(
        "Hoàn thành trong chiều nay",
      ),
    );
  });

  it("creates through the chat submitter and toasts success", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "t9" });
    const onOpenChange = vi.fn();
    renderDialog(
      <CreateTaskFromMessageDialog
        open
        onOpenChange={onOpenChange}
        workspaceId="ws1"
        messageId="m1"
        messageBody="Sửa bug login ngay hôm nay"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tạo/ }));
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: "m1",
          title: "Sửa bug login ngay hôm nay",
        }),
      ),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Đã tạo việc", expect.anything());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("surfaces a create failure as the composer's toast", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("boom"));
    renderDialog(dialog);
    fireEvent.click(screen.getByRole("button", { name: /^Tạo/ }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Không tạo được việc. Thử lại sau giây lát."),
    );
  });

  it("offers to open the created task from the toast", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "t9" });
    const push = vi.fn();
    const nav = {
      push,
      replace: vi.fn(),
      back: vi.fn(),
      pathname: "/",
      searchParams: new URLSearchParams(),
    };
    const service = new FeatureFlagService(
      new StaticProvider({ drive_connector: { default: false } }),
    );
    render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <NavigationProvider value={nav as unknown as NavigationAdapter}>
            <WorkspaceProvider workspace={defaultWorkspace} user={defaultUser}>
              {dialog}
            </WorkspaceProvider>
          </NavigationProvider>
        </FeatureFlagsProvider>,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tạo/ }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const options = mocks.toastSuccess.mock.calls[0]?.[1] as {
      action: { label: string; onClick: () => void };
    };
    expect(options.action.label).toBe("Mở");
    options.action.onClick();
    expect(push).toHaveBeenCalledWith("/acme/team/tasks/t9");
  });
});
