import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentEditLockState, DocumentEditRequest } from "@uniwork/core/api/endpoints/documents-edit-lock";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentEditLockBanner } from "./document-edit-lock-banner";
import { formatLockTime } from "./edit-lock-copy";
import { EditLockHolderChip } from "./edit-lock-holder-chip";
import { EditRequestPrompt } from "./edit-request-prompt";
import { editLockBannerView, type EditLockViewInput } from "./edit-lock-view-model";

// UNI-1645 addendum §11.3: one case per row of the UI-state table (web page column).

const { t } = initI18n();
// Times of today: the banner names today's by the clock alone.
const today = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const SINCE = today(0, 12);
const HOLD = today(23, 30);
const EXPIRES = today(0, 27);
const hhmm = (iso: string) => new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

type Session = EditLockViewInput["session"];
const session = (phase: Session["phase"], over: Partial<Session> = {}): Session => ({ phase, holder: null, lostReason: null, lostBy: null, ...over });
const holderLock = (over: Partial<NonNullable<DocumentEditLockState["lock"]>> = {}) => ({
  holder_id: "u2", holder_name: "An", since: SINCE, expires_at: EXPIRES, reserved: false, held_by_me: false, ...over,
});
const r1 = (over: Partial<DocumentEditLockState> = {}): DocumentEditLockState => ({
  lock: holderLock(), my_request: null, pending_requests: [], can_take_over: false, can_request: true, server_time: SINCE, ...over,
});
const request = (over: Partial<DocumentEditRequest> = {}): DocumentEditRequest => ({
  request_id: "r1", document_id: "d1", requester_id: "me", requester_name: "Bình", holder_id: "u2",
  status: "pending", created_at: SINCE, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), ...over,
});

function renderBanner(input: Partial<EditLockViewInput> & { session: Session }) {
  const handlers = { onTakeOver: vi.fn(), onRequest: vi.fn(), onCancelRequest: vi.fn(), onEditHere: vi.fn(), onEditNow: vi.fn() };
  const view = editLockBannerView({ lockState: undefined, showLost: false, notReleased: false, rateLimitedMinutes: null, ...input });
  render(<DocumentEditLockBanner view={view} {...handlers} />);
  return { ...handlers, view, region: screen.getByTestId("edit-lock-banner-status") };
}

describe("DocumentEditLockBanner (addendum §11.3)", () => {
  it("acquiring: says nothing (no read-only chip or notice), the status region stays mounted", () => {
    const { region } = renderBanner({ session: session("acquiring"), lockState: r1({ lock: null }) });
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByText(t("documents.save.readonly"))).toBeNull();
  });

  it("mine: says nothing, not even 'editing' about oneself", () => {
    const { region } = renderBanner({ session: session("mine"), lockState: r1({ lock: holderLock({ held_by_me: true }) }) });
    expect(region).toBeEmptyDOMElement();
  });

  it("other (online), edit level: names the holder and since when, offers 'Request to edit'", () => {
    const { region, onRequest } = renderBanner({ session: session("other"), lockState: r1() });
    expect(region).toHaveTextContent(`An đang sửa từ ${hhmm(SINCE)}. Bạn đang xem ở chế độ chỉ đọc.`);
    expect(screen.getByTestId("edit-lock-banner").querySelector(".lucide-pencil")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lấy quyền sửa" })).toBeNull();
    const btn = screen.getByRole("button", { name: "Yêu cầu quyền sửa" });
    expect(btn).toHaveClass("border-input");
    fireEvent.click(btn);
    expect(onRequest).toHaveBeenCalled();
  });

  it("other (online), manage level: offers primary 'Take over editing' instead of a request", () => {
    const { onTakeOver } = renderBanner({ session: session("other"), lockState: r1({ can_take_over: true, can_request: true }) });
    expect(screen.queryByRole("button", { name: "Yêu cầu quyền sửa" })).toBeNull();
    const btn = screen.getByRole("button", { name: "Lấy quyền sửa" });
    expect(btn).toHaveClass("bg-primary");
    fireEvent.click(btn);
    expect(onTakeOver).toHaveBeenCalled();
  });

  it("other + offline hold: says until when the holder keeps editing offline with CloudOff icon", () => {
    const { region } = renderBanner({ session: session("other"), lockState: r1({ lock: holderLock({ offline_hold_until: HOLD }) }) });
    expect(region).toHaveTextContent(`An giữ quyền sửa offline đến ${hhmm(HOLD)}.`);
    expect(screen.getByTestId("edit-lock-banner").querySelector(".lucide-cloud-off")).toBeTruthy();
  });

  it("other, same user (another tab or device): 'You're editing in another window' + 'Edit here' with AppWindow icon", () => {
    const { region, onEditHere } = renderBanner({ session: session("other"), lockState: r1({ lock: holderLock({ holder_id: "me", held_by_me: true }) }) });
    expect(region).toHaveTextContent("Bạn đang sửa tài liệu này ở cửa sổ khác.");
    expect(screen.getByTestId("edit-lock-banner").querySelector(".lucide-app-window")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sửa ở đây" }));
    expect(onEditHere).toHaveBeenCalled();
  });

  it("other, before R1 is read: the 423's holder is named (and the same user reads 'another window')", () => {
    const holder = { id: "u2", name: "An", since: SINCE, expiresAt: EXPIRES, offlineHoldUntil: null, heldByMe: false, currentRevision: "4" };
    const { region } = renderBanner({ session: session("other", { holder }) });
    expect(region).toHaveTextContent(`An đang sửa từ ${hhmm(SINCE)}.`);
  });

  it("unheld (just released or expired): 'No one is editing' + 'Edit now' in success tone with CircleCheck icon", () => {
    const { region, onEditNow } = renderBanner({ session: session("other"), lockState: r1({ lock: null }) });
    expect(region).toHaveTextContent("Không còn ai sửa tài liệu này.");
    expect(screen.getByTestId("edit-lock-banner").querySelector(".bg-success-soft")).toBeTruthy();
    expect(screen.getByTestId("edit-lock-banner").querySelector(".lucide-circle-check")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sửa ngay" }));
    expect(onEditNow).toHaveBeenCalled();
  });

  it("lost + clean (page): back to what R1 says, someone else or unheld, with no lost sentence", () => {
    renderBanner({ session: session("lost", { lostReason: "taken_over", lostBy: { id: "u2", name: "An" } }), lockState: r1({ can_take_over: true }) });
    expect(screen.getByTestId("edit-lock-banner")).toHaveTextContent(`An đang sửa từ ${hhmm(SINCE)}.`);
    expect(screen.getByTestId("edit-lock-banner")).not.toHaveTextContent("đã lấy quyền sửa");
  });

  it("lost + unsaved (Office frame, which has no dialog yet): the host banner says why first", () => {
    const { region } = renderBanner({ session: session("lost", { lostReason: "taken_over", lostBy: { id: "u2", name: "An" } }), lockState: r1(), showLost: true });
    expect(region).toHaveTextContent("An đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.");
    expect(region).toHaveTextContent(`An đang sửa từ ${hhmm(SINCE)}.`);
  });

  it("a revoked session never explains itself here: the sign-out path owns it", () => {
    const { region } = renderBanner({ session: session("lost", { lostReason: "session_revoked" }), lockState: r1(), showLost: true });
    expect(region).toBeEmptyDOMElement();
  });

  it("request pending (requester): shows only 'Request sent… expires at' + 'Cancel request' with Send icon, no holder prefix", () => {
    const pending = request();
    const { region, onCancelRequest } = renderBanner({ session: session("other"), lockState: r1({ my_request: pending, can_request: false }) });
    expect(region.textContent).toBe(`Đã gửi yêu cầu tới An. Yêu cầu hết hạn lúc ${formatLockTime(pending.expires_at, "vi")}.`);
    expect(screen.getByTestId("edit-lock-banner").querySelector(".lucide-send")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yêu cầu quyền sửa" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hủy yêu cầu" }));
    expect(onCancelRequest).toHaveBeenCalledWith("r1");
  });

  it("request declined or expired: muted tone with Clock icon, only 'chưa nhả quyền sửa' + 'Ask again'", () => {
    const { region } = renderBanner({ session: session("other"), lockState: r1(), notReleased: true });
    expect(region.textContent).toBe("An chưa nhả quyền sửa.");
    expect(screen.getByTestId("edit-lock-banner").querySelector(".bg-muted")).toBeTruthy();
    expect(screen.getByTestId("edit-lock-banner").querySelector(".lucide-clock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yêu cầu lại" })).toBeTruthy();
  });

  it("rate limited: muted tone with Clock icon, only the rate-limit sentence and no request button", () => {
    const { region } = renderBanner({ session: session("other"), lockState: r1(), rateLimitedMinutes: 3 });
    expect(region.textContent).toBe("Bạn đã yêu cầu nhiều lần. Thử lại sau 3 phút.");
    expect(screen.getByTestId("edit-lock-banner").querySelector(".bg-muted")).toBeTruthy();
    expect(screen.getByTestId("edit-lock-banner").querySelector(".lucide-clock")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yêu cầu quyền sửa" })).toBeNull();
  });

  it("holder chip renders as an info-soft pill matching the board", () => {
    render(<EditLockHolderChip name="An" />);
    const chip = screen.getByTestId("edit-lock-holder");
    expect(chip).toHaveClass("rounded-full", "bg-info-soft", "text-info-soft-foreground");
  });

  it("a handover reserved for this user: nothing (the editor claims it now)", () => {
    const { region } = renderBanner({ session: session("other"), lockState: r1({ lock: holderLock({ holder_id: "me", reserved: true, held_by_me: true }) }) });
    expect(region).toBeEmptyDOMElement();
  });

  it("R2 failed for another reason: says so; the session retries by itself", () => {
    const { region } = renderBanner({ session: session("error") });
    expect(region).toHaveTextContent("Chưa lấy được quyền sửa. Thử lại sau ít phút.");
  });

  it("incoming request (holder): the prompt shows the remaining minutes from expiresAt and offers save-and-hand-over, decline and close (R6-1)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
      const onAccept = vi.fn();
      const onDecline = vi.fn();
      const onDismiss = vi.fn();
      render(
        <EditRequestPrompt
          requesterName="Bình"
          createdAt="2026-10-16T09:59:40Z"
          expiresAt="2026-10-16T10:15:00Z"
          onAccept={onAccept}
          onDecline={onDecline}
          onDismiss={onDismiss}
          focusOnMount
        />,
      );
      const prompt = screen.getByRole("region", { name: "Bình muốn sửa tài liệu này" });
      expect(prompt).toHaveFocus();
      expect(prompt).toHaveTextContent("Vừa xong · tự hết hạn sau 15 phút");
      fireEvent.click(screen.getByRole("button", { name: "Lưu và nhường quyền" }));
      fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
      fireEvent.click(screen.getByRole("button", { name: t("common.close") }));
      expect([onAccept, onDecline, onDismiss].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("incoming request (holder): a 5-minute-old request reads relative age and remaining minutes, and a malformed or missing expiresAt degrades to title only (R6-1)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-16T10:05:00Z"));
      const { unmount } = render(
        <EditRequestPrompt
          requesterName="Bình"
          createdAt="2026-10-16T10:00:00Z"
          expiresAt="2026-10-16T10:15:00Z"
          onAccept={vi.fn()}
          onDecline={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      const prompt = screen.getByRole("region", { name: "Bình muốn sửa tài liệu này" });
      expect(prompt).toHaveTextContent("5 phút trước · tự hết hạn sau 10 phút");
      expect(prompt).not.toHaveTextContent("Vừa xong");
      unmount();

      // Fallback when createdAt is absent: derives age from expiresAt - 15 min
      const { unmount: unmountNoCreated } = render(
        <EditRequestPrompt
          requesterName="Bình"
          expiresAt="2026-10-16T10:15:00Z"
          onAccept={vi.fn()}
          onDecline={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.getByRole("region", { name: "Bình muốn sửa tài liệu này" })).toHaveTextContent("5 phút trước · tự hết hạn sau 10 phút");
      unmountNoCreated();

      // Malformed expiresAt: degrades to title only, never NaN
      render(
        <EditRequestPrompt
          requesterName="Bình"
          createdAt="2026-10-16T10:00:00Z"
          expiresAt="not-a-date"
          onAccept={vi.fn()}
          onDecline={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      const malformedPrompt = screen.getByRole("region", { name: "Bình muốn sửa tài liệu này" });
      expect(malformedPrompt).not.toHaveTextContent("tự hết hạn");
      expect(malformedPrompt).not.toHaveTextContent("NaN");
    } finally {
      vi.useRealTimers();
    }
  });

  it("incoming request whose save failed: says nothing was handed over", () => {
    render(<EditRequestPrompt requesterName="Bình" onAccept={vi.fn()} onDecline={vi.fn()} onDismiss={vi.fn()} saveFailed />);
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa lưu được nên chưa nhường quyền. Thử lại.");
  });

  // CFE-1-14: the live region holds the sentence only; the actions sit outside it and stay focusable while an action runs.
  it("the polite status region carries text only: no button inside it", () => {
    const { region } = renderBanner({ session: session("other"), lockState: r1() });
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("An đang sửa từ");
    expect(region.querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Yêu cầu quyền sửa" })).toBeTruthy();
  });

  it("while an action is pending the buttons are aria-disabled (still focusable) and do nothing", () => {
    const handlers = { onTakeOver: vi.fn(), onRequest: vi.fn(), onCancelRequest: vi.fn(), onEditHere: vi.fn(), onEditNow: vi.fn() };
    const view = editLockBannerView({ session: session("other"), lockState: r1(), showLost: false, notReleased: false, rateLimitedMinutes: null });
    render(<DocumentEditLockBanner view={view} {...handlers} pending />);
    const button = screen.getByRole("button", { name: "Yêu cầu quyền sửa" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(handlers.onRequest).not.toHaveBeenCalled();
  });

  it("the holder's request prompt announces itself politely, text only, buttons outside", () => {
    render(<EditRequestPrompt requesterName="Bình" onAccept={vi.fn()} onDecline={vi.fn()} onDismiss={vi.fn()} />);
    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Bình muốn sửa tài liệu này");
    expect(live.querySelector("button")).toBeNull();
  });

  it("the prompt's buttons are aria-disabled while the answer is pending", () => {
    const onDecline = vi.fn();
    render(<EditRequestPrompt requesterName="Bình" onAccept={vi.fn()} onDecline={onDecline} onDismiss={vi.fn()} pending />);
    const decline = screen.getByRole("button", { name: "Từ chối" });
    expect(decline).toHaveAttribute("aria-disabled", "true");
    expect(decline).not.toBeDisabled();
    fireEvent.click(decline);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("lost + unsaved: each sentence is its own line in the visible strip (V-6)", () => {
    const { region } = renderBanner({ session: session("lost", { lostReason: "taken_over", lostBy: { id: "u2", name: "An" } }), lockState: r1(), showLost: true });
    const wrapper = region.parentElement as HTMLElement;
    const lines = Array.from(wrapper.querySelectorAll("[aria-hidden='true'] > .block")).map((el) => el.textContent);
    expect(lines).toEqual(["An đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.", `An đang sửa từ ${hhmm(SINCE)}. Bạn đang xem ở chế độ chỉ đọc.`]);
    // The status region still reads them as one sentence run.
    expect(region.textContent).toBe(lines.join(" "));
  });
});
