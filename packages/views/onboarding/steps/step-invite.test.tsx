import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { StepInvite } from "./step-invite";
import { expectInactive } from "../../test/inactive";

initI18n();
beforeEach(() => requestMock.mockReset());

const ws = { id: "w1", slug: "doi-alpha", name: "Đội Alpha", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom" };

/** Type an address into the chips box and commit it as a chip. */
function addEmail(email: string) {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: email } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function chipsBox(container: HTMLElement): HTMLElement {
  const box = container.querySelector<HTMLElement>('[data-slot="email-chips"]');
  if (!box) throw new Error("chips box not found");
  return box;
}

describe("StepInvite", () => {
  it("finish disabled until sent; skip always available", async () => {
    requestMock.mockResolvedValueOnce({ invitations: [{ id: "i1", email: "b@x.com", role: "member" }], skipped: [] });
    const onFinish = vi.fn();
    const onSkip = vi.fn();
    render(wrap(<StepInvite workspace={ws} onFinish={onFinish} onSkip={onSkip} />));
    expectInactive(screen.getByRole("button", { name: "Hoàn tất" }));
    expectInactive(screen.getByRole("button", { name: "Gửi lời mời" }));
    addEmail("b@x.com");
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() => expect(screen.getByText("Đã gửi 1 lời mời")).toBeInTheDocument());
    expect(screen.getByText("b@x.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hoàn tất" })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua, mời sau" }));
    expect(onSkip).toHaveBeenCalled();
  });

  /**
   * Nửa dưới của bước này từng để trống cho tới khi gửi được lời mời đầu tiên.
   * Nó phải trả lời câu khiến người ta chần chừ — "đồng nghiệp tôi nhận gì?" —
   * rồi nhường chỗ cho danh sách đã gửi, chứ không phải cả hai cùng lúc.
   */
  it("explains what the invitee receives, then hands the space to the sent list", async () => {
    requestMock.mockResolvedValueOnce({ invitations: [{ id: "i1", email: "b@x.com", role: "member" }], skipped: [] });
    render(wrap(<StepInvite workspace={ws} onFinish={vi.fn()} onSkip={vi.fn()} />));
    expect(screen.getByRole("heading", { name: "Người được mời sẽ thấy gì" })).toBeInTheDocument();
    addEmail("b@x.com");
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() => expect(screen.getByText("Đã gửi 1 lời mời")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Người được mời sẽ thấy gì" })).not.toBeInTheDocument();
  });

  /**
   * A malformed chip is never sent, and the server therefore never reports it as
   * skipped either. Clearing the whole box on success destroyed the only copy of
   * an address the user had just been told to fix, and nothing said so.
   */
  it("sends only the valid addresses and keeps the malformed ones in the box", async () => {
    requestMock.mockResolvedValueOnce({ invitations: [{ id: "i1", email: "a@x.com", role: "member" }], skipped: [] });
    const { container } = render(wrap(<StepInvite workspace={ws} onFinish={vi.fn()} onSkip={vi.fn()} />));
    addEmail("a@x.com");
    addEmail("bad");
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() => expect(screen.getByText("Đã gửi 1 lời mời")).toBeInTheDocument());
    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining("/invitations"),
      expect.objectContaining({ body: { emails: ["a@x.com"], role: "member" } }),
    );
    const box = chipsBox(container);
    expect(within(box).getByText("bad")).toBeInTheDocument();
    expect(within(box).queryByText("a@x.com")).toBeNull();
  });

  it("tells the user the malformed addresses stayed behind, and stops saying so once they are gone", async () => {
    requestMock.mockResolvedValueOnce({ invitations: [{ id: "i1", email: "a@x.com", role: "member" }], skipped: [] });
    render(wrap(<StepInvite workspace={ws} onFinish={vi.fn()} onSkip={vi.fn()} />));
    addEmail("a@x.com");
    addEmail("bad");
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() =>
      expect(screen.getAllByText("Những địa chỉ chưa đúng định dạng vẫn ở lại đây và chưa được gửi.").length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getByRole("button", { name: /Xóa bad/ }));
    await waitFor(() =>
      expect(screen.queryByText("Những địa chỉ chưa đúng định dạng vẫn ở lại đây và chưa được gửi.")).toBeNull(),
    );
    expect(screen.getAllByText("Bạn có thể thêm đợt nữa, hoặc hoàn tất.").length).toBeGreaterThan(0);
  });

  /**
   * `e2e/onboarding-shell.spec.ts` measures every `[data-slot="field"]` against
   * the onboarding column. The role control used to be a `<Field className="sm:w-44">`
   * and rendered at 176px in a 448px column, failing that guard.
   */
  it("keeps the role control out of the Field slots, with the label still associated", () => {
    const { container } = render(wrap(<StepInvite workspace={ws} onFinish={vi.fn()} onSkip={vi.fn()} />));
    const trigger = container.querySelector("#invite-role");
    expect(trigger).not.toBeNull();
    expect(trigger?.closest('[data-slot="field"]')).toBeNull();
    expect(container.querySelector('label[for="invite-role"]')).not.toBeNull();
    for (const field of container.querySelectorAll('[data-slot="field"]')) {
      // No fixed or breakpoint width on a Field itself — that is exactly what
      // the e2e geometry guard measures.
      expect(field.className).not.toMatch(/\bw-\d|\b[a-z]+:w-|\bmax-w-/);
    }
  });

  it("keeps the same heading element and size on both states of the swapping region", async () => {
    requestMock.mockResolvedValueOnce({ invitations: [{ id: "i1", email: "b@x.com", role: "member" }], skipped: [] });
    render(wrap(<StepInvite workspace={ws} onFinish={vi.fn()} onSkip={vi.fn()} />));
    const before = screen.getByRole("heading", { level: 2, name: "Người được mời sẽ thấy gì" });
    expect(before.className).toContain("text-label");
    addEmail("b@x.com");
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    const after = await screen.findByRole("heading", { level: 2, name: "Đã gửi 1 lời mời" });
    expect(after.className).toContain("text-label");
    expect(screen.getByRole("list", { name: "Đã gửi 1 lời mời" })).toBeInTheDocument();
  });

  /**
   * Violet belongs to meetings in `layout/module-tones.ts` and the green tint
   * foreground is the same hex as `--success`, so the tinted glyphs were
   * decoration that also mimicked the "đã gửi" check. Neutral, all three.
   */
  it("tints no glyph in the empty-state panel", () => {
    const { container } = render(wrap(<StepInvite workspace={ws} onFinish={vi.fn()} onSkip={vi.fn()} />));
    expect(container.querySelectorAll('[class*="text-tint-"]')).toHaveLength(0);
  });

  it("stacks the footer buttons full width, like the other three steps", () => {
    render(wrap(<StepInvite workspace={ws} onFinish={vi.fn()} onSkip={vi.fn()} />));
    for (const name of ["Hoàn tất", "Bỏ qua, mời sau"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("w-full");
      expect(button.className).not.toMatch(/sm:w-auto|sm:min-w-/);
    }
  });

  /** The panel (~150px) and a one-row sent list (~110px) swap in place; without
      a floor the footer jumps up under the pointer the instant Send is clicked. */
  it("reserves a height floor for the region that swaps panel for list", () => {
    const { container } = render(wrap(<StepInvite workspace={ws} onFinish={vi.fn()} onSkip={vi.fn()} />));
    const panel = container.querySelector("section");
    expect(panel?.parentElement?.className).toMatch(/min-h-/);
  });
});
