import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { StepOrganization } from "./step-organization";
import { expectInactive } from "../../test/inactive";

initI18n();

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockReset();
});

const org = { id: "o1", slug: "unicom", name: "Unicom", role: "owner" };
const other = { id: "o2", slug: "acme", name: "Acme", role: "member" };

function renderStep(props: Partial<Parameters<typeof StepOrganization>[0]> = {}) {
  return render(
    wrap(<StepOrganization organizations={[]} selected={null} onSelected={() => {}} {...props} />),
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

/** Fill the name (which derives the slug) and press the create CTA. */
function submit(name: string) {
  fireEvent.change(screen.getByLabelText("Tên tổ chức"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: `Tạo ${name}` }));
}

describe("StepOrganization", () => {
  it("shows inline error on 409", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("dup", "conflict", 409));
    renderStep();
    submit("Unicom");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("đã có người dùng"));
  });

  it("reports a conflict once — inline, not also as a toast — and focuses the slug", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("dup", "conflict", 409));
    renderStep();
    submit("Unicom");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Đường dẫn"));
  });

  it("treats a create that resolves with null as a failure instead of silently doing nothing", async () => {
    // parseWithFallback(..., null, ...) turns a drifted payload into a RESOLVED
    // mutation carrying nothing. The organization exists on the server, so the
    // one thing the user must not get is silence.
    requestMock.mockResolvedValueOnce({ organisation: { id: "o9" } });
    const onSelected = vi.fn();
    renderStep({ onSelected });
    submit("Unicom");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Không tạo được tổ chức. Vui lòng thử lại."),
    );
    expect(onSelected).not.toHaveBeenCalled();
    // The CTA is back to its idle label, which is exactly why the failure has
    // to be announced: nothing else on screen changed.
    expect(screen.getByRole("button", { name: "Tạo Unicom" })).toBeInTheDocument();
  });

  it("renders a translated inline error for a server validation rejection, never the server's sentence", async () => {
    const serverSentence = "định danh chỉ gồm a-z, 0-9 và dấu gạch ngang (2-40 ký tự)";
    requestMock.mockRejectedValueOnce(new ApiError(serverSentence, "invalid_request", 400));
    renderStep();
    submit("Unicom");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Định danh không hợp lệ"),
    );
    expect(screen.queryByText(serverSentence)).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falls back to the translated toast for an unmapped failure and leaks no server text", async () => {
    const serverSentence = "gói hiện tại không cho tạo thêm tổ chức";
    requestMock.mockRejectedValueOnce(new ApiError(serverSentence, "entitlement_required", 403));
    renderStep();
    submit("Unicom");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Không tạo được tổ chức. Vui lòng thử lại."),
    );
    expect(toast.error).not.toHaveBeenCalledWith(serverSentence);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for a URL, not a name, when the typed name cannot be slugified", () => {
    renderStep();
    fireEvent.change(screen.getByLabelText("Tên tổ chức"), { target: { value: "株式会社" } });
    expect(visibleHint()).toBe("Đặt đường dẫn cho tổ chức để tạo.");
  });

  it("still asks for a name while the name field is empty", () => {
    renderStep();
    expect(visibleHint()).toBe("Đặt tên tổ chức để tạo.");
  });

  it("names the one organization in the headline, but stays neutral with several", () => {
    const { unmount } = renderStep({ organizations: [org] });
    expect(screen.getByText("Tiếp tục với Unicom, hoặc tạo tổ chức khác.")).toBeInTheDocument();
    unmount();
    renderStep({ organizations: [org, other] });
    expect(screen.queryByText(/Tiếp tục với Unicom, hoặc/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chọn tổ chức của bạn, hoặc tạo tổ chức khác." })).toBeInTheDocument();
  });

  it("keeps an emoji whole in the avatar tile", () => {
    renderStep({ organizations: [{ ...org, name: "🚀 Đội Alpha" }] });
    expect(screen.getByRole("radio", { name: /Đội Alpha/ })).toHaveTextContent("🚀");
    expect(screen.getByRole("radio", { name: /Đội Alpha/ })).not.toHaveTextContent("�");
  });

  it("resume: picking an existing org enables continue", () => {
    const onSelected = vi.fn();
    renderStep({ organizations: [org], onSelected });
    expectInactive(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(screen.getByRole("radio", { name: /Unicom/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục với Unicom" }));
    expect(onSelected).toHaveBeenCalledWith(org);
  });

  it("does not open an organization while a create is still in flight", async () => {
    requestMock.mockImplementationOnce(() => new Promise(() => {}));
    const onSelected = vi.fn();
    renderStep({ organizations: [org], onSelected });
    fireEvent.click(screen.getByRole("radio", { name: /Tạo tổ chức mới/ }));
    submit("Acme");
    // Switching cards mid-request is what makes the `picked && isCreating`
    // state reachable at all.
    fireEvent.click(screen.getByRole("radio", { name: /Unicom/ }));
    const cta = await screen.findByRole("button", { name: "Tiếp tục với Unicom" });
    expectInactive(cta);
    fireEvent.click(cta);
    expect(onSelected).not.toHaveBeenCalled();
  });
});
