// A composer's draft (use-drafts.ts, data/stores/draft-store.ts): it comes
// back when the room opens again, is written after a pause in typing and at
// once when the composer goes or the app leaves the front, is cleared by a
// send, and survives an edit that borrows the field.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { useDraftStore } from "@/data/stores/draft-store";
import { render, viText } from "@/test/render";
import { Composer } from "./composer";
import { DRAFT_SAVE_MS } from "./use-drafts";

jest.mock("./use-voice-recorder", () => ({
  VOICE_MAX_MS: 120_000,
  useVoiceRecorder: () => ({ active: false, elapsedMs: 0, start: jest.fn(), cancel: jest.fn(), send: jest.fn() }),
}));

const KEY = "u1/w1/r1/";

const props = (extra: Partial<Parameters<typeof Composer>[0]> = {}): Parameters<typeof Composer>[0] => ({
  draftKey: KEY,
  candidates: [],
  canSend: true,
  allowAttachments: true,
  reply: null,
  edit: null,
  onCancelReply: jest.fn(),
  onCancelEdit: jest.fn(),
  onSend: jest.fn(),
  onSendFile: jest.fn(),
  onEdit: jest.fn(),
  onTyping: jest.fn(),
  onSendVoice: jest.fn(),
  onOpenExpressions: jest.fn(),
  onOpenReminder: jest.fn(),
  ...extra,
});

const input = () => screen.getByLabelText(viText("chat.message_placeholder"));
const kept = () => useDraftStore.getState().drafts[KEY]?.text;

let appState: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  useDraftStore.getState().clearAll();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_event: string, handler: (state: AppStateStatus) => void) => {
    appState = handler;
    return { remove: jest.fn() };
  }) as never);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Composer drafts", () => {
  it("opens on what was left unsent, and keeps what is typed after a pause", async () => {
    useDraftStore.getState().setText(KEY, "Mai họp");
    await render(<Composer {...props()} />);
    expect(input().props.value).toBe("Mai họp");
    await fireEvent.changeText(input(), "Mai họp lúc 9 giờ");
    expect(kept()).toBe("Mai họp");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_SAVE_MS);
    });
    expect(kept()).toBe("Mai họp lúc 9 giờ");
  });

  it("keeps the last words at once when the app leaves the front or the room closes", async () => {
    const { unmount } = await render(<Composer {...props()} />);
    await fireEvent.changeText(input(), "đang viết");
    await act(async () => appState?.("background"));
    expect(kept()).toBe("đang viết");
    await fireEvent.changeText(input(), "đang viết tiếp");
    await act(async () => appState?.("active"));
    expect(kept()).toBe("đang viết");
    await unmount();
    expect(kept()).toBe("đang viết tiếp");
  });

  it("is cleared by a send", async () => {
    useDraftStore.getState().setText(KEY, "Gửi đây");
    const p = props();
    await render(<Composer {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.send") }));
    expect(p.onSend).toHaveBeenCalledWith("Gửi đây");
    expect(kept()).toBeUndefined();
    expect(input().props.value).toBe("");
  });

  it("comes back after an edit borrowed the field, saved or cancelled", async () => {
    const p = props();
    const { rerender } = await render(<Composer {...p} />);
    await fireEvent.changeText(input(), "nháp của tôi");
    await rerender(<Composer {...p} edit={{ id: "m1", body: "tin cũ" }} />);
    expect(input().props.value).toBe("tin cũ");
    expect(kept()).toBe("nháp của tôi");
    await fireEvent.changeText(input(), "tin đã sửa");
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.edit_dialog_save") }));
    expect(p.onEdit).toHaveBeenCalledWith("m1", "tin đã sửa");
    expect(input().props.value).toBe("nháp của tôi");
    await rerender(<Composer {...p} edit={{ id: "m2", body: "tin khác" }} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("common.cancel") }));
    expect(input().props.value).toBe("nháp của tôi");
    expect(kept()).toBe("nháp của tôi");
  });

  it("keeps a picked mention in the draft, but not one picked while editing", async () => {
    const candidates = [{ kind: "member" as const, userId: "u2", label: "Bình" }];
    const p = props({ candidates });
    const { rerender } = await render(<Composer {...p} />);
    await fireEvent.changeText(input(), "@Bì");
    await fireEvent(input(), "selectionChange", { nativeEvent: { selection: { start: 3, end: 3 } } });
    await fireEvent.press(screen.getByRole("button", { name: "@Bình" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_SAVE_MS);
    });
    expect(kept()).toBe("@Bình ");
    await rerender(<Composer {...p} edit={{ id: "m1", body: "cũ" }} />);
    await fireEvent.changeText(input(), "cũ @Bì");
    await fireEvent(input(), "selectionChange", { nativeEvent: { selection: { start: 6, end: 6 } } });
    await fireEvent.press(screen.getByRole("button", { name: "@Bình" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_SAVE_MS);
    });
    expect(kept()).toBe("@Bình ");
  });

  it("keeps nothing without a key", async () => {
    await render(<Composer {...props({ draftKey: undefined })} />);
    await fireEvent.changeText(input(), "không giữ");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_SAVE_MS);
    });
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.send") }));
    expect(useDraftStore.getState().drafts).toEqual({});
  });

  it("gives an empty field back after an edit when nothing is kept", async () => {
    const p = props({ draftKey: undefined });
    const { rerender } = await render(<Composer {...p} />);
    await rerender(<Composer {...p} edit={{ id: "m1", body: "tin cũ" }} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("common.cancel") }));
    expect(input().props.value).toBe("");
  });
});
