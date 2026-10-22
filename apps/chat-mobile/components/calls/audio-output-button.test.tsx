import { AudioSession } from "@livekit/react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { nativeCalls } from "@/data/calls/native-calls";
import { useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { AudioOutputButton } from "./audio-output-button";

jest.mock("@livekit/react-native", () => ({
  AudioSession: {
    getAudioOutputs: jest.fn(async () => ["speaker", "earpiece"]),
    selectAudioOutput: jest.fn(async () => undefined),
    showAudioRoutePicker: jest.fn(async () => undefined),
  },
}));

jest.mock("@/data/calls/native-calls", () => ({ nativeCalls: { setProximityScreenOff: jest.fn() } }));

const session = jest.mocked(AudioSession);
const proximity = jest.mocked(nativeCalls.setProximityScreenOff);
const os = Platform.OS;

function setOS(value: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { value, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  setOS("android");
  session.getAudioOutputs.mockResolvedValue(["speaker", "earpiece"]);
  session.selectAudioOutput.mockResolvedValue(undefined);
});
afterEach(() => useToastStore.getState().clear());
afterAll(() => setOS(os));

describe("AudioOutputButton", () => {
  it("toggles speaker and earpiece when the phone has only those", async () => {
    await render(<AudioOutputButton video={false} connected />);
    await waitFor(() => expect(session.getAudioOutputs).toHaveBeenCalled());
    const button = await screen.findByRole("button", { name: viText("mobile.call_audio.earpiece") });
    await fireEvent.press(button);
    await waitFor(() => expect(session.selectAudioOutput).toHaveBeenLastCalledWith("speaker"));
    expect(await screen.findByRole("button", { name: viText("chat.mobile.call_speaker") })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.call_speaker") }));
    await waitFor(() => expect(session.selectAudioOutput).toHaveBeenLastCalledWith("earpiece"));
  });

  it("lists every output with a headset there, marks the one in use, and routes to the choice", async () => {
    session.getAudioOutputs.mockResolvedValue(["speaker", "earpiece", "bluetooth"]);
    await render(<AudioOutputButton video={false} connected />);
    // LiveKit put the call on Bluetooth by itself.
    const button = await screen.findByRole("button", { name: viText("mobile.call_audio.bluetooth") });
    await fireEvent.press(button);
    expect(await screen.findByText(viText("mobile.call_audio.in_use", { output: viText("mobile.call_audio.bluetooth") }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(viText("mobile.call_audio.earpiece")));
    await waitFor(() => expect(session.selectAudioOutput).toHaveBeenCalledWith("earpiece"));
  });

  it("goes back and says so when the route cannot change", async () => {
    session.selectAudioOutput.mockRejectedValue(new Error("busy"));
    await render(<AudioOutputButton video connected={false} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.call_speaker") }));
    await waitFor(() => expect(useToastStore.getState().toasts.at(-1)?.message).toBe(viText("mobile.call_audio.failed")));
    expect(screen.getByRole("button", { name: viText("chat.mobile.call_speaker") })).toBeOnTheScreen();
  });

  it("takes an Android that reports nothing as the phone alone", async () => {
    session.getAudioOutputs.mockRejectedValue(new Error("no session"));
    await render(<AudioOutputButton video connected />);
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.mobile.call_speaker") }));
    await waitFor(() => expect(session.selectAudioOutput).toHaveBeenCalledWith("earpiece"));
  });

  it("turns the screen off at the ear while a voice call plays on the earpiece, and back on off it", async () => {
    const { unmount } = await render(<AudioOutputButton video={false} connected />);
    await waitFor(() => expect(proximity).toHaveBeenLastCalledWith(true));
    await fireEvent.press(await screen.findByRole("button", { name: viText("mobile.call_audio.earpiece") }));
    // On the speaker the phone is not at the ear.
    await waitFor(() => expect(proximity).toHaveBeenLastCalledWith(false));
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.mobile.call_speaker") }));
    await waitFor(() => expect(proximity).toHaveBeenLastCalledWith(true));
    await unmount();
    expect(proximity).toHaveBeenLastCalledWith(false);
  });

  it("leaves the screen alone for a video call and before the call connects", async () => {
    await render(<AudioOutputButton video connected />);
    await render(<AudioOutputButton video={false} connected={false} />);
    expect(proximity).not.toHaveBeenCalledWith(true);
  });

  it("shows the system route picker on iOS", async () => {
    setOS("ios");
    await render(<AudioOutputButton video={false} connected />);
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.call_audio.title") }));
    expect(session.showAudioRoutePicker).toHaveBeenCalledTimes(1);
    expect(session.getAudioOutputs).not.toHaveBeenCalled();
    session.showAudioRoutePicker.mockRejectedValueOnce(new Error("gone"));
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.call_audio.title") }));
    await waitFor(() => expect(useToastStore.getState().toasts.at(-1)?.message).toBe(viText("mobile.call_audio.failed")));
  });

  it("forgets a route read that lands after the call screen went", async () => {
    let resolve: (value: string[]) => void = () => undefined;
    session.getAudioOutputs.mockReturnValue(new Promise((r) => (resolve = r)));
    const view = await render(<AudioOutputButton video={false} connected />);
    await view.unmount();
    resolve(["bluetooth"]);
    await Promise.resolve();
  });
});
