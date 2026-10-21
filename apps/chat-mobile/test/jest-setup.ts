// Shared setup for the jest-expo component layer (jest.config.js).
import { setUpTests } from "react-native-reanimated";

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
  const player = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), replace: jest.fn(), remove: jest.fn(), release: jest.fn(), loop: false, volume: 1 };
  const recorder = { prepareToRecordAsync: jest.fn(async () => {}), record: jest.fn(), stop: jest.fn(async () => {}), getStatus: jest.fn(() => ({ durationMillis: 0 })), uri: null };
  return {
    setAudioModeAsync: jest.fn(async () => {}),
    createAudioPlayer: jest.fn(() => player),
    useAudioPlayer: jest.fn(() => player),
    useAudioPlayerStatus: jest.fn(() => ({ playing: false, currentTime: 0, duration: 0, didJustFinish: false, isLoaded: true })),
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
    useAudioRecorder: jest.fn(() => recorder),
    useAudioRecorderState: jest.fn(() => ({ isRecording: false, durationMillis: 0 })),
  };
});

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
