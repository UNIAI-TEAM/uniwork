// A chat push's buttons follow the app lock as carried out (chat-category-sync.tsx): nothing registered until the
// saved choices are read, the locked category while the lock is on — the person's or the organization's — and a
// new registration each time either changes.
import { act } from "@testing-library/react-native";
import { createStore } from "zustand/vanilla";
import { render } from "@/test/render";
import { ChatCategorySync } from "./chat-category-sync";

interface FakePrivacy {
  settings: { appLock: boolean; relockAfterMs: number; screenSecurity: boolean; usageStats: boolean };
  floor: { appLock: boolean; screenSecurity: boolean };
  loaded: boolean;
  restored: boolean;
}

const mockPrivacy = createStore<FakePrivacy>(() => ({
  settings: { appLock: false, relockAfterMs: 60_000, screenSecurity: false, usageStats: true },
  floor: { appLock: false, screenSecurity: false },
  loaded: false,
  restored: false,
}));
jest.mock("./privacy", () => {
  const { useStore } = jest.requireActual<typeof import("zustand")>("zustand");
  const { withFloor } = jest.requireActual<typeof import("@/lib/app-lock")>("@/lib/app-lock");
  return {
    usePrivacySettings: () => {
      const state = useStore(mockPrivacy);
      return { ...state, settings: withFloor(state.settings as never, state.floor) };
    },
  };
});
const mockRegister = jest.fn(async (_t: unknown, _platform: string, _locked: boolean) => undefined);
jest.mock("@/data/chat-notification-actions", () => ({
  registerChatMessageCategory: (t: unknown, platform: string, locked: boolean) => mockRegister(t, platform, locked),
}));

const lockedArgs = () => mockRegister.mock.calls.map(([, , locked]) => locked);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrivacy.setState({
    settings: { appLock: false, relockAfterMs: 60_000, screenSecurity: false, usageStats: true },
    floor: { appLock: false, screenSecurity: false },
    loaded: false,
    restored: false,
  });
});

describe("ChatCategorySync", () => {
  it("registers nothing until the saved choices are read, then the category they call for", async () => {
    await render(<ChatCategorySync />);
    expect(mockRegister).not.toHaveBeenCalled();
    await act(() => mockPrivacy.setState({ loaded: true, restored: true }));
    expect(lockedArgs()).toEqual([false]);
  });

  it("registers again, locked, when the person turns the lock on and when the organization requires it", async () => {
    mockPrivacy.setState({ loaded: true, restored: true });
    await render(<ChatCategorySync />);
    await act(() => mockPrivacy.setState((s) => ({ settings: { ...s.settings, appLock: true } })));
    await act(() => mockPrivacy.setState((s) => ({ settings: { ...s.settings, appLock: false } })));
    await act(() => mockPrivacy.setState({ floor: { appLock: true, screenSecurity: false } }));
    // The capture block alone changes nothing.
    await act(() => mockPrivacy.setState({ floor: { appLock: true, screenSecurity: true } }));
    expect(lockedArgs()).toEqual([false, true, false, true]);
  });

  it("is locked while the saved choices could not be read", async () => {
    mockPrivacy.setState({ loaded: true, restored: false });
    await render(<ChatCategorySync />);
    expect(lockedArgs()).toEqual([true]);
  });
});
