import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap, wrapWithNav } from "../../test/api-mock";
import { StepOrganization } from "./step-organization";
import { expectInactive } from "../../test/inactive";

initI18n();

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";

beforeEach(() => {
  resetAuthStoreForTests();
  requestMock.mockReset();
  vi.mocked(toast.error).mockReset();
});

const org = { id: "o1", slug: "unicom", name: "Unicom", role: "owner" };
const other = { id: "o2", slug: "acme", name: "Acme", role: "member" };

/** Signed in, so the workspace list behind "Manage organization" loads. */
function signIn() {
  setSessionUser({
    id: "u1",
    email: "ha@unicom.vn",
    display_name: "Hà",
    onboarded_at: null,
    email_verified_at: "2026-09-01T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  });
}

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
      expect(toast.error).toHaveBeenCalledWith("Không tạo được tổ chức. Thử lại."),
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
      expect(screen.getByRole("alert")).toHaveTextContent("Đường dẫn không hợp lệ"),
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
      expect(toast.error).toHaveBeenCalledWith("Không tạo được tổ chức. Thử lại."),
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
    expect(screen.getByRole("heading", { name: "Tiếp tục với Unicom." })).toBeInTheDocument();
    unmount();
    renderStep({ organizations: [org, other] });
    expect(screen.queryByText(/Tiếp tục với Unicom/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chọn tổ chức của bạn." })).toBeInTheDocument();
  });

  it("does not offer to create a second organization to someone who already belongs to one", () => {
    renderStep({ organizations: [org] });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.queryByRole("radio", { name: /Tạo tổ chức/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tên tổ chức")).not.toBeInTheDocument();
    expect(visibleHint()).toBe("Chọn tổ chức để tiếp tục.");
  });

  it("offers the create form when the only membership was switched off (ADR 0032 D1)", () => {
    renderStep({ organizations: [{ ...org, status: "active", deactivated: true }] });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tên tổ chức")).toBeInTheDocument();
  });

  it("explains the one-organization rule when the server refuses, with a way to the organization's settings", async () => {
    signIn();
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [
            {
              id: "w9",
              slug: "other",
              name: "Other",
              organization_id: "o9",
              organization_slug: "nine",
              organization_name: "Nine",
            },
            {
              id: "w1",
              slug: "team",
              name: "Team",
              organization_id: "o1",
              organization_slug: "unicom",
              organization_name: "Unicom",
            },
          ],
        });
      }
      return Promise.reject(
        new ApiError("đã thuộc tổ chức", "already_in_organization", 409, undefined, {
          organization: { id: "o1", name: "Unicom", slug: "unicom" },
        }),
      );
    });
    render(wrapWithNav(<StepOrganization organizations={[]} selected={null} onSelected={() => {}} />));
    submit("Acme");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bạn đã thuộc Unicom");
    expect(alert).toHaveTextContent(
      "Mỗi tài khoản chỉ thuộc một tổ chức. Muốn tạo tổ chức mới, rời hoặc đóng tổ chức hiện tại trước.",
    );
    expect(screen.queryByText("đã thuộc tổ chức")).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Quản lý tổ chức" })).toHaveAttribute(
        "href",
        "/unicom/team/settings?tab=organization",
      ),
    );
  });

  it("replaces the create form with the way to the organization once refused, so nothing invites a second refusal", async () => {
    signIn();
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/workspaces"
        ? Promise.resolve({ workspaces: [] })
        : Promise.reject(
            new ApiError("đã thuộc tổ chức", "already_in_organization", 409, undefined, {
              organization: { id: "o1", name: "Unicom", slug: "unicom" },
            }),
          ),
    );
    render(wrapWithNav(<StepOrganization organizations={[]} selected={null} onSelected={() => {}} />));
    submit("Acme");
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Tên tổ chức")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạo Acme" })).not.toBeInTheDocument();
    expect(visibleHint()).toBe("Tổ chức của bạn đã có sẵn.");
    // The footer's primary control is the link, and there is exactly one.
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Quản lý tổ chức" })).toHaveLength(1));
  });

  it("explains a one-card picker and points at the organization's settings for a different one", async () => {
    signIn();
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/workspaces"
        ? Promise.resolve({
            workspaces: [
              {
                id: "w1",
                slug: "team",
                name: "Team",
                organization_id: "o1",
                organization_slug: "unicom",
                organization_name: "Unicom",
              },
            ],
          })
        : Promise.resolve({}),
    );
    render(wrapWithNav(<StepOrganization organizations={[org]} selected={null} onSelected={() => {}} />));
    expect(screen.getByText("Workspace mới sẽ nằm trong Unicom. Mỗi tài khoản thuộc một tổ chức.")).toBeInTheDocument();
    expect(await screen.findByText("Cần tổ chức khác? Rời hoặc đóng Unicom trước.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quản lý tổ chức" })).toHaveAttribute(
      "href",
      "/unicom/team/settings?tab=organization",
    );
  });

  it("sends the person to create a workspace in that organization when it has none they can open", async () => {
    signIn();
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/workspaces"
        ? Promise.resolve({ workspaces: [] })
        : Promise.reject(
            new ApiError("đã thuộc tổ chức", "already_in_organization", 409, undefined, {
              organization: { id: "o1", name: "Unicom", slug: "unicom" },
            }),
          ),
    );
    render(wrapWithNav(<StepOrganization organizations={[]} selected={null} onSelected={() => {}} />));
    submit("Acme");
    await screen.findByRole("alert");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Quản lý tổ chức" })).toHaveAttribute("href", "/workspaces/new"),
    );
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
});
