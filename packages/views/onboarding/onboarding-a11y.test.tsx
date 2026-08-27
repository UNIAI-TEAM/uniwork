import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { EMPTY_QUESTIONNAIRE } from "@uniwork/core/onboarding";
import { requestMock, wrap } from "../test/api-mock";
import { OnboardingFlow } from "./onboarding-flow";
import { StepAboutYou } from "./steps/step-about-you";

initI18n();

vi.mock("@uniwork/core/auth", () => ({
  useSession: () => ({
    status: "authed",
    user: { id: "u1", email: "a@x.com", display_name: "A", onboarded_at: null, email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} },
  }),
  useLogout: () => ({ mutate: vi.fn() }),
}));

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
    if (path === "/api/v1/orgs") return Promise.resolve({ organizations: [] });
    return Promise.resolve({ user: { id: "u1", onboarding_questionnaire: {} } });
  });
});

/**
 * Các hợp đồng khả dụng của onboarding. Chúng dễ hỏng âm thầm khi refactor —
 * giao diện vẫn "trông đúng" trong khi người dùng bàn phím và screen reader mất
 * đường đi. Mỗi test dưới đây khoá lại một khiếm khuyết đã từng có thật.
 */
describe("onboarding accessibility contracts", () => {
  it("dùng input radio/checkbox thật, không phải role gắn lên button", () => {
    render(<StepAboutYou answers={EMPTY_QUESTIONNAIRE} onChange={() => {}} onAdvance={() => {}} onSkip={() => {}} />);

    // Radio native → trình duyệt tự lo roving tabindex và phím mũi tên.
    const role = screen.getByRole("radio", { name: "Quản lý" });
    expect(role.tagName).toBe("INPUT");
    expect(role).toHaveAttribute("type", "radio");

    const useCase = screen.getByRole("checkbox", { name: "Quản lý công việc nhóm" });
    expect(useCase.tagName).toBe("INPUT");

    // Cùng một `name` là điều kiện để chúng thành MỘT nhóm.
    expect(role).toHaveAttribute("name", "onboarding-role");
  });

  it("ô nhập của lựa chọn 'Khác' không nằm trong control khác", () => {
    render(
      <StepAboutYou
        answers={{ ...EMPTY_QUESTIONNAIRE, role: "other" }}
        onChange={() => {}}
        onAdvance={() => {}}
        onSkip={() => {}}
      />,
    );
    const free = screen.getByRole("textbox", { name: /.+/ });
    // `<button>`/`<label>` bọc một control khác là sai content model HTML và
    // khiến screen reader không tới được ô nhập.
    expect(free.closest("button")).toBeNull();
    expect(free.closest("label")).toBeNull();
  });

  it("chuyển bước thì tiêu điểm về tiêu đề bước mới, không rơi về body", async () => {
    render(wrap(<OnboardingFlow onComplete={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: /Bắt đầu/ }));

    const heading = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // Nhận tiêu điểm bằng chương trình thì phải có tabIndex -1, và KHÔNG được
    // thành một điểm dừng Tab thừa.
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("dàn ý heading chỉ có h1 của bước — rail không chèn heading nào", async () => {
    render(wrap(<OnboardingFlow onComplete={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: /Bắt đầu/ }));

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // Tên bước trong rail từng là <h3>: bốn heading chen vào dàn ý TRƯỚC h1 của
    // trang, khiến chế độ duyệt heading của screen reader rơi vào rail.
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.tagName)).toEqual(["H1"]);
  });

  it("có vùng live cố định cho hint, thay vì gắn aria-live lên tiêu đề", async () => {
    render(wrap(<OnboardingFlow onComplete={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: /Bắt đầu/ }));

    const status = await screen.findByRole("status");
    expect(status).toBeInTheDocument();
    // Vùng live phải có mặt trong DOM TRƯỚC khi nội dung đổi mới đọc đáng tin;
    // gắn lên tiêu đề (mount mới mỗi bước) thì không đạt điều đó.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).not.toHaveAttribute("aria-live");
  });

  it("thanh tiến độ mobile nói được vị trí bước, không chỉ vẽ ra", async () => {
    render(wrap(<OnboardingFlow onComplete={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: /Bắt đầu/ }));
    expect(await screen.findByText(/Bước 1 trên 4/)).toBeInTheDocument();
  });

  it("danh sách card chọn nằm trong radiogroup có nhãn", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
      if (path === "/api/v1/orgs")
        return Promise.resolve({ organizations: [{ id: "o1", name: "Unicom", slug: "unicom" }] });
      return Promise.resolve({ user: { id: "u1", onboarding_questionnaire: {} } });
    });
    render(wrap(<OnboardingFlow onComplete={() => {}} mode="new_workspace" />));

    const group = await screen.findByRole("radiogroup", { name: "Chọn tổ chức" });
    // Radio mồ côi (không có nhóm sở hữu) thì screen reader không đọc được
    // "1 trong 2" và không gom chúng thành một lựa chọn.
    expect(within(group).getAllByRole("radio").length).toBeGreaterThan(1);
  });
});
