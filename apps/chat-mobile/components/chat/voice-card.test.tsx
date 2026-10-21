// A voice message's player (voice-card.tsx): it plays and pauses, a tap on the
// bars seeks there, the speed chip cycles 1× / 1.5× / 2×, and a screen reader
// gets one adjustable control that seeks five seconds a swipe and says when
// the clip cannot play yet.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { render, viText } from "@/test/render";
import { VoiceCard } from "./voice-card";

const record = ChatMessageSchema.parse({
  id: "v1",
  room_id: "r1",
  workspace_id: "w1",
  sender_id: "u2",
  sender_display_name: "Bình",
  kind: "voice",
  body: "",
  created_at: "2026-10-22T02:00:00Z",
  voice: { url: "https://x/v1.m4a", url_expires_at: "2099-01-01T00:00:00Z", duration_ms: 42_000 },
});
const voice = record.voice as NonNullable<typeof record.voice>;
const ctx = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", roomId: "r1", userId: "u1", onOpenImage: jest.fn(), onVotePoll: jest.fn(), onOpenLink: jest.fn(), onLinkMenu: jest.fn() };

const player = () => jest.mocked(useAudioPlayer).mock.results.at(-1)?.value as { play: jest.Mock; pause: jest.Mock; seekTo: jest.Mock; setPlaybackRate: jest.Mock };
const status = (extra: Partial<ReturnType<typeof useAudioPlayerStatus>>) =>
  jest.mocked(useAudioPlayerStatus).mockReturnValue({ playing: false, currentTime: 0, duration: 42, didJustFinish: false, isLoaded: true, ...extra } as ReturnType<typeof useAudioPlayerStatus>);

beforeEach(() => {
  jest.clearAllMocks();
  status({});
});

const playButton = () => screen.getByTestId("voice-play");

describe("VoiceCard", () => {
  it("plays, and pauses while playing", async () => {
    const onLongPress = jest.fn();
    const { rerender } = await render(<VoiceCard record={record} voice={voice} ctx={ctx} own={false} onLongPress={onLongPress} />);
    expect(playButton().props.accessibilityLabel).toBe(`${viText("chat.voice_play")}, 0:42`);
    await fireEvent.press(playButton());
    await act(async () => undefined);
    expect(player().play).toHaveBeenCalled();
    status({ playing: true, currentTime: 12 });
    await rerender(<VoiceCard record={record} voice={voice} ctx={ctx} own onLongPress={onLongPress} />);
    expect(screen.getByText("0:12 / 0:42")).toBeOnTheScreen();
    await fireEvent.press(playButton());
    expect(player().pause).toHaveBeenCalled();
  });

  it("starts a finished clip over", async () => {
    status({ didJustFinish: true, currentTime: 42 });
    await render(<VoiceCard record={record} voice={voice} ctx={ctx} own={false} onLongPress={jest.fn()} />);
    await fireEvent.press(playButton());
    await act(async () => undefined);
    expect(player().seekTo).toHaveBeenCalledWith(0);
  });

  it("is one adjustable control to a screen reader: its place in the clip, five seconds a swipe, play on activate, the menu", async () => {
    status({ currentTime: 40 });
    const onLongPress = jest.fn();
    await render(<VoiceCard record={record} voice={voice} ctx={ctx} own={false} onLongPress={onLongPress} />);
    const control = screen.getByRole("adjustable");
    expect(control.props.accessibilityValue).toEqual({ text: viText("chat.message_list.voice_position", { position: "0:40", duration: "0:42" }) });
    await fireEvent(control, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    expect(player().seekTo).toHaveBeenLastCalledWith(42);
    await fireEvent(control, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });
    expect(player().seekTo).toHaveBeenLastCalledWith(35);
    await fireEvent(control, "accessibilityAction", { nativeEvent: { actionName: "activate" } });
    await act(async () => undefined);
    expect(player().play).toHaveBeenCalled();
    await fireEvent(control, "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(control.props.accessibilityActions.map((a: { label?: string }) => a.label)).toContain(viText("mobile.voice.seek_forward", { seconds: 5 }));
  });

  it("seeks where the bars are tapped", async () => {
    await render(<VoiceCard record={record} voice={voice} ctx={ctx} own={false} onLongPress={jest.fn()} />);
    const bars = screen.getByTestId("voice-bars", { includeHiddenElements: true });
    await fireEvent(bars, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 210, height: 26 } } });
    await fireEvent.press(bars, { nativeEvent: { locationX: 105 } });
    expect(player().seekTo).toHaveBeenLastCalledWith(21);
  });

  it("cycles the speed 1×, 1.5×, 2× and back", async () => {
    await render(<VoiceCard record={record} voice={voice} ctx={ctx} own={false} onLongPress={jest.fn()} />);
    for (const rate of [1.5, 2, 1]) {
      await fireEvent.press(screen.getByTestId("voice-rate"));
      expect(player().setPlaybackRate).toHaveBeenLastCalledWith(rate);
      expect(screen.getByRole("button", { name: viText("chat.voice_speed_label", { rate }) })).toBeOnTheScreen();
    }
  });

  it("says the clip cannot play while its address is not there yet", async () => {
    const expired = { ...voice, url: "", url_expires_at: "2000-01-01T00:00:00Z" };
    status({ duration: 0 });
    await render(<VoiceCard record={{ ...record, voice: expired }} voice={expired} ctx={ctx} own={false} onLongPress={jest.fn()} />);
    expect(screen.getByRole("adjustable").props.accessibilityState).toEqual({ disabled: true });
  });
});
