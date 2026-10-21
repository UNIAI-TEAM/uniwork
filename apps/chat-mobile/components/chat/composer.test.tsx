import { act, fireEvent, screen } from "@testing-library/react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { toast } from "@/data/stores/toast-store";
import type { ChatMentionCandidate } from "@/lib/mentions";
import { render, viText } from "@/test/render";
import { Composer } from "./composer";
import { useVoiceRecorder } from "./use-voice-recorder";

jest.mock("./use-voice-recorder", () => ({ VOICE_MAX_MS: 120_000, useVoiceRecorder: jest.fn() }));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));

const voice = { active: false, elapsedMs: 0, start: jest.fn(async () => true), cancel: jest.fn(async () => {}), send: jest.fn(async () => {}) };
const mockVoice = (extra: Partial<typeof voice> = {}) => jest.mocked(useVoiceRecorder).mockReturnValue({ ...voice, ...extra });

const candidates: ChatMentionCandidate[] = [
  { kind: "all", label: "all" },
  { kind: "member", userId: "u2", label: "Bình", email: "binh@x.vn" },
  { kind: "member", userId: "u3", label: "Chi" },
];

const props = (extra: Partial<Parameters<typeof Composer>[0]> = {}): Parameters<typeof Composer>[0] => ({
  candidates,
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
const sendButton = () => screen.getByRole("button", { name: viText("chat.send") });

beforeEach(() => {
  mockVoice();
  // The attach sheet runs a choice after iOS reports the modal gone (useAfterDismiss); Android runs it at once.
  jest.replaceProperty(Platform, "OS", "android");
  // Failures are toasts now (data/stores/toast-store.ts), not blocking alerts.
  jest.spyOn(toast, "error").mockImplementation(() => 0);
});
afterEach(() => jest.restoreAllMocks());

describe("Composer", () => {
  it("records a voice message from an empty draft and sends text once there is some", async () => {
    const p = props();
    await render(<Composer {...p} />);
    expect(screen.getByRole("button", { name: viText("chat.voice_message") })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: viText("chat.send") })).toBeNull();
    await fireEvent.changeText(input(), "  Chào cả nhà  ");
    expect(sendButton()).toBeEnabled();
    await fireEvent.press(sendButton());
    expect(p.onSend).toHaveBeenCalledWith("Chào cả nhà");
    expect(input()).toHaveDisplayValue("");
  });

  it("keeps send disabled on an empty draft where there is no voice button", async () => {
    await render(<Composer {...props({ allowAttachments: false })} />);
    expect(sendButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: viText("chat.composer_attach") })).toBeNull();
    expect(screen.queryByRole("button", { name: viText("chat.expression_picker_open") })).toBeNull();
  });

  it("signals typing 600 ms after the draft stops changing, and not for a blank draft", async () => {
    jest.useFakeTimers();
    try {
      const p = props();
      await render(<Composer {...p} />);
      await fireEvent.changeText(input(), "Ch");
      await act(() => jest.advanceTimersByTime(300));
      await fireEvent.changeText(input(), "Chào");
      await act(() => jest.advanceTimersByTime(599));
      expect(p.onTyping).not.toHaveBeenCalled();
      await act(() => jest.advanceTimersByTime(1));
      expect(p.onTyping).toHaveBeenCalledTimes(1);
      await fireEvent.changeText(input(), "   ");
      await act(() => jest.advanceTimersByTime(1_000));
      expect(p.onTyping).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("suggests people after @ and sends the mention as a token", async () => {
    const p = props();
    await render(<Composer {...p} />);
    await fireEvent.changeText(input(), "@Bì");
    await fireEvent(input(), "selectionChange", { nativeEvent: { selection: { start: 3, end: 3 } } });
    expect(screen.getByLabelText(viText("chat.mention_picker_label"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "@Bình" }));
    expect(input()).toHaveDisplayValue("@Bình ");
    await fireEvent.changeText(input(), "@Bình xem nhé");
    await fireEvent.press(sendButton());
    expect(p.onSend).toHaveBeenCalledWith("[@Bình](mention://member/u2) xem nhé");
  });

  it("offers @all with what it does", async () => {
    await render(<Composer {...props()} />);
    await fireEvent.changeText(input(), "@");
    await fireEvent(input(), "selectionChange", { nativeEvent: { selection: { start: 1, end: 1 } } });
    expect(screen.getByRole("button", { name: `@all, ${viText("chat.mention_all_hint")}` })).toBeOnTheScreen();
  });

  it("shows whom a reply answers and cancels it", async () => {
    const p = props({ reply: { id: "m1", sender: "Bình", text: "Mai họp nhé" } });
    await render(<Composer {...p} />);
    expect(screen.getByText(viText("chat.replying_to", { preview: "Mai họp nhé" }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.cancel_reply") }));
    expect(p.onCancelReply).toHaveBeenCalled();
  });

  it("edits a message from its own text and keeps its mention ids", async () => {
    const p = props({ edit: { id: "m9", body: "[@Dũng](mention://member/u9) gửi file" } });
    await render(<Composer {...p} />);
    expect(screen.getByText(viText("chat.edit_dialog_title"))).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue("@Dũng gửi file");
    // Editing has no attachments and sends no typing signal.
    expect(screen.queryByRole("button", { name: viText("chat.composer_attach") })).toBeNull();
    await fireEvent.changeText(input(), "@Dũng gửi file nhé");
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.edit_dialog_save") }));
    expect(p.onEdit).toHaveBeenCalledWith("m9", "[@Dũng](mention://member/u9) gửi file nhé");
    expect(p.onTyping).not.toHaveBeenCalled();
  });

  it("cancels an edit and empties the field", async () => {
    const p = props({ edit: { id: "m9", body: "cũ" } });
    await render(<Composer {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("common.cancel") }));
    expect(p.onCancelEdit).toHaveBeenCalled();
    expect(input()).toHaveDisplayValue("");
  });

  it("refuses a message past the length cap and says by how much", async () => {
    const p = props();
    await render(<Composer {...p} />);
    await fireEvent.changeText(input(), "a".repeat(4003));
    expect(screen.getByText(viText("chat.composer_state.chars_over_other", { count: 3 }))).toBeOnTheScreen();
    expect(sendButton()).toBeDisabled();
    await fireEvent.press(sendButton());
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("says why sending is closed instead of showing a field", async () => {
    await render(<Composer {...props({ canSend: false })} />);
    expect(screen.getByText(viText("chat.mute_composer_placeholder"))).toBeOnTheScreen();
    expect(screen.queryByLabelText(viText("chat.message_placeholder"))).toBeNull();
  });

  it("shows the recording clock with cancel and send while a voice message records", async () => {
    mockVoice({ active: true, elapsedMs: 42_000 });
    await render(<Composer {...props()} />);
    expect(screen.getByLabelText(viText("chat.voice_recording_aria"))).toBeOnTheScreen();
    expect(screen.getByText(/0:42/)).toBeOnTheScreen();
    expect(screen.queryByLabelText(viText("chat.message_placeholder"))).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: viText("common.cancel") }));
    expect(voice.cancel).toHaveBeenCalled();
    await fireEvent.press(sendButton());
    expect(voice.send).toHaveBeenCalled();
  });

  it("tells the person when the microphone will not record", async () => {
    const start = jest.fn(async () => false);
    mockVoice({ start });
    await render(<Composer {...props()} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_message") }));
    expect(start).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(viText("chat.voice_record_failed"));
    mockVoice({ start: jest.fn(async () => Promise.reject(new Error("busy"))) });
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_message") }));
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("opens stickers from the field and the attach sheet's other entries", async () => {
    const p = props();
    await render(<Composer {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.expression_picker_open") }));
    expect(p.onOpenExpressions).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.composer_attach") }));
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.composer_create_reminder") }));
    expect(p.onOpenReminder).toHaveBeenCalled();
  });

  it("sends a picked photo, and refuses one of the wrong type or too large", async () => {
    const p = props();
    const pick = jest.mocked(ImagePicker.launchImageLibraryAsync);
    const asset = { uri: "file:///p.jpg", fileName: "p.jpg", mimeType: "image/jpeg", fileSize: 1_000, width: 1, height: 1 };
    pick.mockResolvedValueOnce({ canceled: false, assets: [asset] } as never);
    await render(<Composer {...p} />);
    const photo = async () => {
      await fireEvent.press(screen.getByRole("button", { name: viText("chat.composer_attach") }));
      await fireEvent.press(screen.getByRole("button", { name: viText("chat.media_image") }));
    };
    await photo();
    expect(p.onSendFile).toHaveBeenCalledWith({ uri: "file:///p.jpg", name: "p.jpg", mimeType: "image/jpeg", size: 1_000 });

    pick.mockResolvedValueOnce({ canceled: false, assets: [{ ...asset, fileName: "virus.exe", mimeType: "application/x-msdownload" }] } as never);
    await photo();
    expect(toast.error).toHaveBeenLastCalledWith(viText("chat.file_type_unsupported"));

    pick.mockResolvedValueOnce({ canceled: false, assets: [{ ...asset, fileSize: 30 * 1024 * 1024 }] } as never);
    await photo();
    expect(toast.error).toHaveBeenLastCalledWith(viText("chat.file_too_large", { max: "25 MB" }));

    pick.mockResolvedValueOnce({ canceled: true, assets: null } as never);
    await photo();
    expect(p.onSendFile).toHaveBeenCalledTimes(1);
  });

  it("sends a picked document", async () => {
    const p = props();
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///bao-gia.pdf", name: "bao-gia.pdf", mimeType: "application/pdf", size: 2_048, lastModified: 0 }],
    } as never);
    await render(<Composer {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.composer_attach") }));
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.composer_attach_file") }));
    expect(p.onSendFile).toHaveBeenCalledWith({ uri: "file:///bao-gia.pdf", name: "bao-gia.pdf", mimeType: "application/pdf", size: 2_048 });
  });
});
