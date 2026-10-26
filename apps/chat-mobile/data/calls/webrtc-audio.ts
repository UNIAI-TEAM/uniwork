// CallKit's audio session handed to WebRTC, as LiveKit asks of a CallKit app (data/calls/call-session.ts): CallKit
// activates the call's audio, and WebRTC must be told before LiveKit takes it.
//
// The WebRTC package loads on the first audio event, not at the app's start. Its index reads WebRTC's native module,
// enables its logger and registers native event listeners, and the root layout imports call-session.ts on every
// launch, on both platforms. Only CallKit sends an audio event, so Android never loads it from here, and an iPhone
// that never calls never does either (call-overlay.tsx loads the rest of LiveKit the same way).
type RTCAudioSession = (typeof import("@livekit/react-native-webrtc"))["RTCAudioSession"];

function rtcAudioSession(): RTCAudioSession {
  // A static import would load WebRTC with the app shell: this require is the lazy load (no dynamic import() on
  // purpose, Jest's runtime cannot run one); Metro still bundles the package from the literal name.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("@livekit/react-native-webrtc") as typeof import("@livekit/react-native-webrtc")).RTCAudioSession;
}

export const webrtcAudio = {
  activate: (): void => rtcAudioSession().audioSessionDidActivate(),
  deactivate: (): void => rtcAudioSession().audioSessionDidDeactivate(),
};
