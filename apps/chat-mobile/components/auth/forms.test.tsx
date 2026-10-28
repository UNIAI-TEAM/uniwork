import { act, fireEvent, screen } from "@testing-library/react-native";
import { configureRuntime } from "@uniwork/core/runtime-config";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { forgetPendingSignIn, holdStep, usePendingSignIn } from "@/data/auth/pending-sign-in";
import { useAuthStore } from "@/data/auth/store";
import { useLinkPendingTicket } from "@/data/mutations/sign-in";
import { render, viText } from "@/test/render";
import { LinkStep } from "./link-step";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";
import { SecondFactorStep, leaveSecondFactor } from "./second-factor-step";
import { LinkModeNotice } from "./sign-in-notices";

jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("@/data/mutations/sign-in", () => ({ useLinkPendingTicket: jest.fn() }));
jest.mock("@/data/auth/methods-api", () => ({
  stepUp: jest.fn(async (_proof: unknown, action: never, userId: string) => {
    jest.requireActual<typeof import("@/data/auth/step-up-store")>("@/data/auth/step-up-store").holdStepUp(
      { step_up_token: "su_1", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "password" },
      { userId, action },
    );
    return true;
  }),
  stepUpWithProvider: jest.fn(),
  linkProvider: jest.fn(),
  linkPendingTicket: jest.fn(),
  signInMethodsApi: { getSignInMethods: jest.fn(async () => null), sendStepUpEmailCode: jest.fn(), setPassword: jest.fn(), unlink: jest.fn() },
}));

const field = (code: string) => ({ ok: false as const, failure: { code, kind: "field" } as never });
const link = { mutateAsync: jest.fn(async (_input: { userId: string; move?: boolean }) => ({ user: null, methods: null })), isPending: false };
const identity = { provider: "apple" as const, email: "q7@privaterelay.appleid.com", name: "", private_relay: true };

beforeEach(() => {
  configureRuntime({ apiUrl: "https://api.uniworkos.test", wsUrl: "wss://api.uniworkos.test", appUrl: "https://app.uniworkos.test" });
  jest.mocked(useLinkPendingTicket).mockReturnValue(link as never);
});
afterEach(() => {
  forgetPendingSignIn();
  useAuthStore.setState({ user: null });
  link.mutateAsync.mockReset().mockResolvedValue({ user: null, methods: null });
  jest.clearAllMocks();
});

describe("LoginForm", () => {
  it("moves from the address to the password on its key, and opens the web's reset page in the browser", async () => {
    await render(<LoginForm busy={null} message={null} onSubmit={jest.fn(async () => null)} />);
    await act(async () => fireEvent(screen.getByTestId("login-email"), "submitEditing"));
    await act(async () => fireEvent.press(screen.getByTestId("login-forgot")));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.uniworkos.test/forgot-password");
  });

  it("waits while a lock counts down, and takes no typing while another way in runs", async () => {
    const onSubmit = jest.fn(async () => null);
    const { rerender } = await render(<LoginForm busy={null} message="khoá" waiting onSubmit={onSubmit} />);
    expect(screen.getByTestId("login-button")).toBeDisabled();
    await act(async () => fireEvent(screen.getByTestId("login-password"), "submitEditing"));
    expect(onSubmit).not.toHaveBeenCalled();
    await rerender(<LoginForm busy="google" message={null} onSubmit={onSubmit} />);
    // The fields stay editable (a disabled one drops the keyboard and cannot be focused again); what is typed waits.
    expect(screen.getByTestId("login-email").props.editable).toBe(true);
    await act(async () => fireEvent.changeText(screen.getByTestId("login-email"), "an@congty.vn"));
    expect(screen.getByTestId("login-email").props.value).toBe("");
    expect(screen.getByTestId("login-forgot")).toBeDisabled();
  });
});

describe("RegisterForm", () => {
  it("goes field to field on each key, and back to the address when the server refuses it", async () => {
    const onSubmit = jest.fn(async () => field("conflict"));
    await render(<RegisterForm busy={null} message={null} onSubmit={onSubmit} />);
    await act(async () => fireEvent.changeText(screen.getByTestId("register-name"), "An"));
    await act(async () => fireEvent(screen.getByTestId("register-name"), "submitEditing"));
    await act(async () => fireEvent.changeText(screen.getByTestId("register-email"), "an@congty.vn"));
    await act(async () => fireEvent(screen.getByTestId("register-email"), "submitEditing"));
    await act(async () => fireEvent.changeText(screen.getByTestId("register-password"), "12345678"));
    await act(async () => fireEvent(screen.getByTestId("register-password"), "submitEditing"));
    expect(onSubmit).toHaveBeenCalledWith({ displayName: "An", email: "an@congty.vn", password: "12345678" });
  });

  it("names the first empty field, and runs nothing while busy", async () => {
    const onSubmit = jest.fn(async () => null);
    const { rerender } = await render(<RegisterForm busy={null} message={null} onSubmit={onSubmit} />);
    await act(async () => fireEvent.press(screen.getByTestId("register-button")));
    expect(screen.getByText(viText("auth.continue.create.displayNameRequired"))).toBeTruthy();
    expect(screen.getByText(viText("auth.emailRequired"))).toBeTruthy();
    await rerender(<RegisterForm busy="register" message={null} onSubmit={onSubmit} />);
    await act(async () => fireEvent(screen.getByTestId("register-password"), "submitEditing"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(viText("auth.registering"))).toBeTruthy();
  });
});

describe("leaving the second factor", () => {
  it("drops the challenge and goes back, or to sign-in when there is nothing to go back to", () => {
    holdStep({ kind: "mfa", token: "m", context: { method: "password", email: null, provider: null } }, Date.now());
    leaveSecondFactor();
    expect(usePendingSignIn.getState().secondFactor).toBeNull();
    expect(router.back).toHaveBeenCalled();
    jest.mocked(router.canGoBack).mockReturnValueOnce(false);
    leaveSecondFactor();
    expect(router.replace).toHaveBeenCalledWith("/login");
  });

  it("drops the challenge when the screen goes by the edge swipe too, unless the sign-in finished", async () => {
    const challenge = { kind: "mfa" as const, token: "m", context: { method: "password" as const, email: "an@congty.vn", provider: null } };
    holdStep(challenge, Date.now());
    const first = await render(<SecondFactorStep linkMode={false} />);
    await first.unmount();
    expect(usePendingSignIn.getState().secondFactor).toBeNull();
    holdStep(challenge, Date.now());
    const second = await render(<SecondFactorStep linkMode={false} />);
    useAuthStore.setState({ user: { id: "u1" } as never });
    await second.unmount();
    expect(usePendingSignIn.getState().secondFactor).not.toBeNull();
  });
});

describe("LinkModeNotice", () => {
  it("names Apple's hidden email without its address", async () => {
    await render(<LinkModeNotice identity={identity} disabled={false} onDecline={jest.fn()} />);
    expect(screen.getByText(viText("auth.continue.loginMode.bannerRelay", { provider: "Apple" }))).toBeTruthy();
  });
});

describe("LinkStep", () => {
  beforeEach(() => {
    holdStep({ kind: "choice", ticket: "t", nonce: "n", identity, ticketKind: "unmatched" }, Date.now());
    useAuthStore.setState({ user: { id: "u1", email: "an@example.com" } as never });
  });

  const apiError = (code: string, fields: Record<string, unknown> = {}) =>
    Object.assign(new Error(code), { name: "ApiError", status: 409, body: { error: { code, fields } } });

  it("asks about Apple's hidden email, and offers the move without a holder it cannot name", async () => {
    link.mutateAsync.mockRejectedValueOnce(apiError("sign_in_method_movable"));
    await render(<LinkStep />);
    expect(screen.getByText(viText("auth.continue.link.questionRelay", { provider: "Apple", accountEmail: "an@example.com" }))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(screen.getByText(viText("auth.continue.link.movableUnknown", { provider: "Apple" }))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("link-decline")));
    expect(usePendingSignIn.getState().choice).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("says a holder it cannot name, any other refusal in core's words, and a ticket gone as nothing left", async () => {
    link.mutateAsync.mockRejectedValueOnce(apiError("sign_in_method_taken"));
    const { unmount } = await render(<LinkStep />);
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(screen.getByText(viText("auth.continue.link.takenUnknown", { provider: "Apple" }))).toBeTruthy();
    await unmount();
    link.mutateAsync.mockRejectedValueOnce(apiError("sign_in_method_already_linked"));
    const second = await render(<LinkStep />);
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(screen.getByText(viText("settings.security.signInMethods.errors.alreadyLinked"))).toBeTruthy();
    await second.unmount();
    link.mutateAsync.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "TransportError", code: "sign_in_expired" }));
    await render(<LinkStep />);
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(screen.getByTestId("link-nothing")).toBeTruthy();
  });

  it("asks a session older than the ticket to confirm it is you, then links", async () => {
    useAuthStore.setState({ user: { id: "u1", email: "an@example.com", has_password: true } as never });
    link.mutateAsync
      .mockRejectedValueOnce(Object.assign(new Error("proof_required"), { name: "ApiError", status: 403, body: { error: { code: "proof_required", fields: { proofs: ["password"] } } } }))
      .mockResolvedValueOnce({ user: null, methods: null });
    await render(<LinkStep />);
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(screen.getByText(viText("settings.security.stepUp.description", { action: viText("settings.security.stepUp.actions.link_apple") }))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("step-up-password"), "pw"));
    await act(async () => fireEvent.press(screen.getByTestId("step-up-submit")));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(link.mutateAsync).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("link-done")).toBeTruthy();
    jest.requireActual<typeof import("@/data/auth/step-up-store")>("@/data/auth/step-up-store").forgetStepUp();
  });

  it("stays on the question when the proof sheet is closed", async () => {
    // No list in the refusal: the sheet chooses from the account's own state.
    link.mutateAsync.mockRejectedValueOnce(Object.assign(new Error("proof_required"), { name: "ApiError", status: 403, body: { error: { code: "proof_required" } } }));
    await render(<LinkStep />);
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    await act(async () => fireEvent.press(screen.getByTestId("step-up-cancel")));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.getByTestId("link-ask")).toBeTruthy();
    expect(link.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("does nothing without someone signed in", async () => {
    useAuthStore.setState({ user: null });
    await render(<LinkStep />);
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(link.mutateAsync).not.toHaveBeenCalled();
  });
});
