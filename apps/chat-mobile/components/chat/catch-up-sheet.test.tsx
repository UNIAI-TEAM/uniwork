// The catch-up sheet sends nothing to the AI provider before the reader agreed
// to the AI processing notice (Apple 5.1.2(i)).
import { fireEvent, screen } from "@testing-library/react-native";
import { accountApi } from "@/data/account-api";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { render, viText } from "@/test/render";
import { CatchUpBanner, CatchUpSheet } from "./catch-up-sheet";

jest.mock("@/data/chat-api", () => ({ chatApi: { catchUp: jest.fn() } }));
jest.mock("@/data/account-api", () => ({ accountApi: { setAiConsent: jest.fn(), withdrawAiConsent: jest.fn() } }));
jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create<{ user: unknown; setUser: (user: unknown) => void }>((set) => ({ user: null, setUser: (user) => set({ user }) })) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

const user = { id: "u1", email: "an@acme.vn", display_name: "An", onboarded_at: null, email_verified_at: null, onboarding_questionnaire: {}, locale: "vi" };
const target = { roomId: "r1", title: "Bình", unread: 4 };
const brief = { summary: "Họp lúc 3 giờ", highlights: [], highlight_items: [], action_items: [], message_count: 4 };

beforeEach(() => jest.mocked(chatApi.catchUp).mockResolvedValue(brief as never));
afterEach(() => jest.clearAllMocks());

describe("CatchUpSheet and AI consent", () => {
  it("shows the notice instead of asking for a summary, and asks once the reader agrees", async () => {
    useAuthStore.setState({ user });
    jest.mocked(accountApi.setAiConsent).mockResolvedValueOnce({ ...user, ai_consent_version: AI_CONSENT_VERSION, ai_consent_at: "2026-10-21T08:00:00Z" });
    await render(<CatchUpSheet wsId="w1" target={target} onClose={jest.fn()} onOpenRoom={jest.fn()} />);
    expect(screen.getByRole("header", { name: viText("mobile.ai_consent.title") })).toBeOnTheScreen();
    expect(chatApi.catchUp).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: viText("chat.mobile.catch_up_open", { name: "Bình" }) })).toBeNull();

    await fireEvent.press(screen.getByTestId("ai-consent-agree"));
    expect(chatApi.catchUp).toHaveBeenCalledWith("w1", { room_id: "r1", locale: "vi" });
    expect(await screen.findByText("Họp lúc 3 giờ")).toBeOnTheScreen();
  });

  it("not now closes the sheet without sending anything", async () => {
    useAuthStore.setState({ user });
    const onClose = jest.fn();
    await render(<CatchUpSheet wsId="w1" target={target} onClose={onClose} onOpenRoom={jest.fn()} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.ai_consent.decline") }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(chatApi.catchUp).not.toHaveBeenCalled();
  });

  it("asks for the summary at once for a reader who already agreed", async () => {
    useAuthStore.setState({ user: { ...user, ai_consent_version: AI_CONSENT_VERSION } });
    await render(<CatchUpSheet wsId="w1" target={target} onClose={jest.fn()} onOpenRoom={jest.fn()} />);
    expect(await screen.findByText("Họp lúc 3 giờ")).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: viText("mobile.ai_consent.title") })).toBeNull();
  });

  it("lays out the summary, the highlights and the action items, and opens the room", async () => {
    useAuthStore.setState({ user: { ...user, ai_consent_version: AI_CONSENT_VERSION } });
    jest.mocked(chatApi.catchUp).mockResolvedValueOnce({
      ...brief,
      highlight_items: [{ text: "Chốt ngân sách" }],
      highlights: ["ignored when items exist"],
      action_items: [{ title: "Gửi báo giá", owner: "Bình", due: "thứ Sáu" }, { title: "Đặt phòng" }],
    } as never);
    const onOpenRoom = jest.fn();
    await render(<CatchUpSheet wsId="w1" target={target} onClose={jest.fn()} onOpenRoom={onOpenRoom} />);
    expect(await screen.findByText("Chốt ngân sách")).toBeOnTheScreen();
    expect(screen.queryByText("ignored when items exist")).toBeNull();
    expect(screen.getByText("Gửi báo giá")).toBeOnTheScreen();
    expect(screen.getByText("Bình · thứ Sáu")).toBeOnTheScreen();
    expect(screen.getByText("Đặt phòng")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.catch_up_open", { name: "Bình" }) }));
    expect(onOpenRoom).toHaveBeenCalledWith("r1");
  });

  it("reads the plain highlights, says when there is nothing to sum up, and when it failed", async () => {
    useAuthStore.setState({ user: { ...user, ai_consent_version: AI_CONSENT_VERSION } });
    jest.mocked(chatApi.catchUp).mockResolvedValueOnce({ ...brief, summary: "", highlights: ["Một điểm"] } as never);
    const view = await render(<CatchUpSheet wsId="w1" target={target} onClose={jest.fn()} onOpenRoom={jest.fn()} />);
    expect(await screen.findByText("Một điểm")).toBeOnTheScreen();

    jest.mocked(chatApi.catchUp).mockResolvedValueOnce({ ...brief, summary: "", message_count: 0 } as never);
    await view.rerender(<CatchUpSheet wsId="w1" target={{ ...target, roomId: "r2" }} onClose={jest.fn()} onOpenRoom={jest.fn()} />);
    expect(await screen.findByText(viText("chat.ai.catch_up_empty"))).toBeOnTheScreen();

    jest.mocked(chatApi.catchUp).mockResolvedValueOnce(null as never);
    await view.rerender(<CatchUpSheet wsId="w1" target={{ ...target, roomId: "r3" }} onClose={jest.fn()} onOpenRoom={jest.fn()} />);
    expect(await screen.findByText(viText("chat.ai.catch_up_failed"))).toBeOnTheScreen();

    await view.rerender(<CatchUpSheet wsId="w1" target={null} onClose={jest.fn()} onOpenRoom={jest.fn()} />);
    expect(screen.queryByText(viText("chat.ai.catch_up_failed"))).toBeNull();
  });

  it("the banner says how much is unread and opens the sheet", async () => {
    const onPress = jest.fn();
    await render(<CatchUpBanner total={12} rooms={3} onPress={onPress} />);
    await fireEvent.press(screen.getByRole("button", { name: `${viText("chat.sidebar_catch_up_title")}, ${viText("chat.sidebar_catch_up_body", { count: 12, rooms: 3 })}` }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
