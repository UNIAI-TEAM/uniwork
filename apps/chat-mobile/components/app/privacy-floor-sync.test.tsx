// The organization's floor reaches the privacy settings (privacy-floor-sync.tsx): from the current workspace's
// organization once someone is signed in, kept through a drifted answer, lifted on sign-out but not while the
// session is still being restored.
import { act, waitFor } from "@testing-library/react-native";
import { useAuthStore } from "@/data/auth/store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { render } from "@/test/render";
import { PrivacyFloorSync } from "./privacy-floor-sync";

const mockSetFloor = jest.fn();
jest.mock("./privacy", () => ({ setPrivacyFloor: (floor: unknown) => mockSetFloor(floor) }));
const mockPolicy = jest.fn(async (_org: string, _signal?: AbortSignal): Promise<unknown> => ({ require_app_lock: true, block_screen_capture: false }));
jest.mock("@/data/account-api", () => ({ accountApi: { mobileSecurityPolicy: (org: string, signal?: AbortSignal) => mockPolicy(org, signal) } }));
jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create(() => ({ user: null as unknown, isLoading: true })) };
});
jest.mock("@/data/stores/workspace-store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useWorkspaceStore: create(() => ({ current: null as unknown })) };
});

const flush = () => act(async () => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null, isLoading: true });
  useWorkspaceStore.setState({ current: null });
});

describe("PrivacyFloorSync", () => {
  it("lifts nothing while the session is being restored, and reads nothing without a workspace", async () => {
    await render(<PrivacyFloorSync />);
    await flush();
    expect(mockSetFloor).not.toHaveBeenCalled();
    await act(() => useAuthStore.setState({ user: { id: "u1" } as never, isLoading: false }));
    await flush();
    expect(mockPolicy).not.toHaveBeenCalled();
    expect(mockSetFloor).not.toHaveBeenCalled();
  });

  it("hands the current organization's requirements to the privacy settings", async () => {
    useAuthStore.setState({ user: { id: "u1" } as never, isLoading: false });
    useWorkspaceStore.setState({ current: { orgSlug: "acme", wsSlug: "hq", wsId: "w1" } });
    await render(<PrivacyFloorSync />);
    await waitFor(() => expect(mockSetFloor).toHaveBeenCalledWith({ appLock: true, screenSecurity: false }));
    expect(mockSetFloor).toHaveBeenCalledTimes(1);
    expect(mockPolicy).toHaveBeenCalledWith("acme", expect.anything());
  });

  it("keeps the floor it last heard through a drifted answer, and lifts it on sign-out", async () => {
    mockPolicy.mockResolvedValueOnce(null);
    useAuthStore.setState({ user: { id: "u1" } as never, isLoading: false });
    useWorkspaceStore.setState({ current: { orgSlug: "acme", wsSlug: "hq", wsId: "w1" } });
    await render(<PrivacyFloorSync />);
    await waitFor(() => expect(mockPolicy).toHaveBeenCalled());
    await flush();
    expect(mockSetFloor).not.toHaveBeenCalled();
    await act(() => useAuthStore.setState({ user: null }));
    await flush();
    expect(mockSetFloor).toHaveBeenCalledTimes(1);
    expect(mockSetFloor).toHaveBeenCalledWith({ appLock: false, screenSecurity: false });
  });
});
