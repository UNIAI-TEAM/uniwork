import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { StepWorkspace } from "./step-workspace";

initI18n();

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockReset();
});

const org = { id: "o1", slug: "unicom", name: "Unicom" };
const ws = (over: Partial<Workspace> = {}): Workspace =>
  ({
    id: "w1",
    slug: "doi-alpha",
    name: "Đội Alpha",
    organization_id: "o1",
    organization_slug: "unicom",
    organization_name: "Unicom",
    ...over,
  }) as Workspace;

function renderStep(props: Partial<Parameters<typeof StepWorkspace>[0]> = {}) {
  return render(
    wrap(<StepWorkspace organization={org} existing={[]} onCreated={() => {}} {...props} />),
  );
}

/**
 * The hint painted for sighted users. The `role="status"` copy beside it is
 * debounced on purpose (it must not re-read the whole sentence per keystroke),
 * so it still holds the previous string right after a change.
 */
function visibleHint(): string {
  return document.querySelector<HTMLParagraphElement>("p[aria-hidden='true']")?.textContent ?? "";
}

function submit(name: string) {
  fireEvent.change(screen.getByLabelText("Tên workspace"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: `Tạo ${name}` }));
}

describe("StepWorkspace", () => {
  it("creates in the given org and reports busy", async () => {
    // resolve chậm để trạng thái busy quan sát được
    requestMock.mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r({ workspace: ws() }), 30)),
    );
    const onCreated = vi.fn();
    const onBusy = vi.fn();
    renderStep({ onCreated, onBusyChange: onBusy });
    expect(screen.getByText("localhost:3000/unicom/")).toBeInTheDocument();
    submit("Đội Alpha");
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ slug: "doi-alpha" })));
    expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/o1/workspaces", expect.objectContaining({ method: "POST" }));
    expect(onBusy).toHaveBeenCalledWith(true);
  });

  it("409 → inline error", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("dup", "conflict", 409));
    renderStep();
    submit("Đội Alpha");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("đã có người dùng"));
  });

  it("reports a conflict once — inline, not also as a toast — and focuses the slug", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("dup", "conflict", 409));
    renderStep();
    submit("Đội Alpha");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Đường dẫn"));
  });

  it("treats a create that resolves with null as a failure instead of silently doing nothing", async () => {
    requestMock.mockResolvedValueOnce({ workspaces: [] });
    const onCreated = vi.fn();
    renderStep({ onCreated });
    submit("Đội Alpha");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không tạo được. Vui lòng thử lại."));
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Tạo Đội Alpha" })).toBeInTheDocument();
  });

  it("renders a translated inline error for a server validation rejection, never the server's sentence", async () => {
    const serverSentence = "định danh chỉ gồm a-z, 0-9 và dấu gạch ngang (2-40 ký tự)";
    requestMock.mockRejectedValueOnce(new ApiError(serverSentence, "invalid_request", 400));
    renderStep();
    submit("Đội Alpha");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Định danh không hợp lệ"),
    );
    expect(screen.queryByText(serverSentence)).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falls back to the translated toast for an unmapped failure and leaks no server text", async () => {
    const serverSentence = "gói hiện tại đã hết workspace";
    requestMock.mockRejectedValueOnce(new ApiError(serverSentence, "quota_exceeded", 403));
    renderStep();
    submit("Đội Alpha");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không tạo được. Vui lòng thử lại."));
    expect(toast.error).not.toHaveBeenCalledWith(serverSentence);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for a URL, not a name, when the typed name cannot be slugified", () => {
    renderStep();
    fireEvent.change(screen.getByLabelText("Tên workspace"), { target: { value: "株式会社" } });
    expect(visibleHint()).toBe("Đặt đường dẫn cho workspace để tạo.");
  });

  it("still asks for a name while the name field is empty", () => {
    renderStep();
    expect(visibleHint()).toBe("Đặt tên workspace để tạo.");
  });

  it("names the one workspace in the headline, but stays neutral with several", () => {
    const { unmount } = renderStep({ existing: [ws()] });
    expect(screen.getByText("Tiếp tục với Đội Alpha, hoặc tạo workspace khác.")).toBeInTheDocument();
    unmount();
    renderStep({ existing: [ws(), ws({ id: "w2", slug: "doi-beta", name: "Đội Beta" })] });
    expect(screen.queryByText(/Tiếp tục với Đội Alpha, hoặc/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chọn workspace của bạn, hoặc tạo cái mới." })).toBeInTheDocument();
  });

  it("keeps an emoji whole in the avatar tile", () => {
    renderStep({ existing: [ws({ name: "🚀 Đội Alpha" })] });
    const card = screen.getByRole("radio", { name: /Đội Alpha/ });
    expect(card).toHaveTextContent("🚀");
    expect(card).not.toHaveTextContent("�");
  });

  it("does not open a workspace while a create is still in flight", async () => {
    requestMock.mockImplementationOnce(() => new Promise(() => {}));
    const onCreated = vi.fn();
    renderStep({ existing: [ws()], onCreated });
    fireEvent.click(screen.getByRole("radio", { name: /Tạo workspace mới/ }));
    submit("Đội Beta");
    fireEvent.click(screen.getByRole("radio", { name: /Đội Alpha/ }));
    const cta = await screen.findByRole("button", { name: "Mở Đội Alpha" });
    expect(cta).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(cta);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
