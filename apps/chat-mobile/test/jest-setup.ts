// Shared setup for the jest-expo component layer (jest.config.js).
import { setUpTests } from "react-native-reanimated";
// The gesture runtime's own Jest mocks: every bottom sheet mounts a GestureHandlerRootView and a pan
// (components/ui/bottom-sheet.tsx), so every screen with a sheet needs them, not only the gesture tests.
import "react-native-gesture-handler/jestSetup";

// Reanimated's test mode: animations jump to their end, layout animations are no-ops.
setUpTests();

jest.mock("react-native-safe-area-context", () => jest.requireActual("react-native-safe-area-context/jest/mock").default);

// expo-router's index pulls in its native stack, which reaches expo-glass-effect's
// native view (unmocked by jest-expo on iOS). The component layer renders
// components, not routes: it needs the navigation themes lib/theme.ts spreads
// and a router to assert pushes on. A test that navigates reads `mockRouter`.
jest.mock("expo-router", () => {
  const fonts = {
    regular: { fontFamily: "System", fontWeight: "400" },
    medium: { fontFamily: "System", fontWeight: "500" },
    bold: { fontFamily: "System", fontWeight: "600" },
    heavy: { fontFamily: "System", fontWeight: "700" },
  };
  const colors = { primary: "", background: "", card: "", text: "", border: "", notification: "" };
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), dismissAll: jest.fn(), dismissTo: jest.fn(), canGoBack: jest.fn(() => true) };
  return {
    DefaultTheme: { dark: false, colors, fonts },
    DarkTheme: { dark: true, colors, fonts },
    router,
    useRouter: () => router,
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => "/",
  };
});

// expo-audio ships no Jest mock and its classes extend native objects. A
// silent player and recorder are enough for components that only hold one;
// a test about recording mocks components/chat/use-voice-recorder instead.
jest.mock("expo-audio", () => {
  const player = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), setPlaybackRate: jest.fn(), replace: jest.fn(), remove: jest.fn(), release: jest.fn(), loop: false, volume: 1 };
  const recorder = { prepareToRecordAsync: jest.fn(async () => {}), record: jest.fn(), stop: jest.fn(async () => {}), getStatus: jest.fn(() => ({ durationMillis: 0 })), uri: null };
  return {
    setAudioModeAsync: jest.fn(async () => {}),
    createAudioPlayer: jest.fn(() => player),
    useAudioPlayer: jest.fn(() => player),
    useAudioPlayerStatus: jest.fn(() => ({ playing: false, currentTime: 0, duration: 0, didJustFinish: false, isLoaded: true })),
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
    getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
    useAudioRecorder: jest.fn(() => recorder),
    useAudioRecorderState: jest.fn(() => ({ isRecording: false, durationMillis: 0 })),
  };
});

// FlashList (2.x, JS only) is the recycling list itself here, laid out in a 400 × 900 window with 100 pt
// cells, since Jest has no layout: a long list mounts about a screenful of cells, as on a device. The
// package's own jestSetup.js cannot be used: it maps FlashList to a RecyclerView export 2.0 does not have.
jest.mock("@shopify/flash-list/dist/recyclerview/utils/measureLayout", () => {
  const actual = jest.requireActual<object>("@shopify/flash-list/dist/recyclerview/utils/measureLayout");
  const window = { x: 0, y: 0, width: 400, height: 900 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => window),
    measureFirstChildLayout: jest.fn(() => window),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 100, height: 100 })),
  };
});

// The keyboard follows the composer through react-native-keyboard-controller's
// native module; its own Jest mock holds the keyboard closed.
jest.mock("react-native-keyboard-controller", () => jest.requireActual("react-native-keyboard-controller/jest"));

// Touch feedback (data/haptics.ts) is native; a test asserts the calls here.
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  performAndroidHapticsAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft", Rigid: "rigid" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  AndroidHaptics: { Confirm: "confirm", Reject: "reject", Long_Press: "long-press", Context_Click: "context-click", Segment_Tick: "segment-tick", Toggle_On: "toggle-on" },
}));

// App lock and screen security (components/app/privacy.ts): native; a test asserts and steers the calls here.
jest.mock("expo-local-authentication", () => ({
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
}));
jest.mock("expo-screen-capture", () => ({
  preventScreenCaptureAsync: jest.fn(async () => undefined),
  allowScreenCaptureAsync: jest.fn(async () => undefined),
  enableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
  disableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
}));

// The permission gate (components/ui/permission-gate.ts) is not mocked here: a component that asks for a
// permission goes through the real gate on the expo modules' Jest mocks (expo-audio's above grants the
// microphone). A test that asserts on the asks mocks the gate itself, in its own file.

// A component test that logs an error (an update outside act, a failed prop
// type, a key warning) fails: the log is the only place those bugs show.
let errors: unknown[][] = [];
beforeEach(() => {
  errors = [];
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});
afterEach(() => {
  const logged = errors;
  errors = [];
  if (logged.length > 0) throw new Error(`console.error during the test:\n${logged.map((args) => args.map(String).join(" ")).join("\n")}`);
});
