import { act, fireEvent, screen } from "@testing-library/react-native";
import { router, useNavigation } from "expo-router";
import { BackHandler } from "react-native";
import { forgetPendingSignIn, holdStep, usePendingSignIn } from "@/data/auth/pending-sign-in";
import type { SignInOutcome, SignInRequest } from "@/data/auth/sign-in";
import { useAuthStore } from "@/data/auth/store";
import { useSendClaimCode } from "@/data/mutations/sign-in";
import { render, viText } from "@/test/render";
import { ClaimCodeStep, ClaimEmailStep } from "./claim-steps";
import { ContinueFlow } from "./continue-flow";

jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("@/data/mutations/sign-in", () => ({ useSendClaimCode: jest.fn() }));

const transport = (code: string, status?: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), { name: "TransportError", code, status, fromServer: status !== undefined, ...extra });
const send = { mutateAsync: jest.fn(async (_email: string) => true), isPending: false };
const identity = { provider: "google" as const, email: "an@gmail.com", name: "An", private_relay: false };
const realLogin = useAuthStore.getState().login;

function signIn(...answers: (SignInOutcome | Error)[]) {
  const login = jest.fn(async (_request?: SignInRequest): Promise<SignInOutcome> => {
    const next = answers.shift() ?? { kind: "dismissed" };
    if (next instanceof Error) throw next;
    return next;
  });
  useAuthStore.setState({ user: null, login });
  return login;
}

beforeEach(() => {
  jest.mocked(useSendClaimCode).mockReturnValue(send as never);
  holdStep({ kind: "choice", ticket: "t", nonce: "n", identity, ticketKind: "unmatched" }, Date.now());
});
afterEach(() => {
  send.mutateAsync.mockReset().mockResolvedValue(true);
  forgetPendingSignIn();
  useAuthStore.setState({ user: null, login: realLogin });
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe("ContinueFlow", () => {
  it("goes back one step on Android's back button and the header's, and drops the choice when it is left", async () => {
    const listen = jest.spyOn(BackHandler, "addEventListener");
    signIn();
    const { unmount } = await render(<ContinueFlow />);
    await act(async () => fireEvent.press(screen.getByTestId("choice-invited")));
    expect(screen.getByTestId("claim-email-step")).toBeTruthy();
    const hardwareBack = listen.mock.calls.at(-1)?.[1] as unknown as () => boolean;
    await act(async () => void hardwareBack());
    expect(screen.getByTestId("choice-invited")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("choice-invited")));
    await act(async () => fireEvent.press(screen.getByTestId("auth-back")));
    expect(screen.getByTestId("choice-invited")).toBeTruthy();
    await unmount();
    expect(usePendingSignIn.getState().choice).toBeNull();
  });

  it("offers to try a create the network dropped again, and cancels back to sign-in", async () => {
    const login = signIn(transport("network"), { kind: "dismissed" });
    jest.mocked(router.canGoBack).mockReturnValueOnce(false);
    await render(<ContinueFlow />);
    await act(async () => fireEvent.press(screen.getByTestId("choice-create")));
    expect(screen.getByText(viText("auth.social.errors.network"))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("continue-retry-create")));
    expect(login).toHaveBeenCalledTimes(2);
    await act(async () => fireEvent.press(screen.getByTestId("continue-cancel")));
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(usePendingSignIn.getState().choice).toBeNull();
  });

  it("creates with the name typed, its own field's go key included, and sends a too long one back", async () => {
    holdStep({ kind: "choice", ticket: "t", nonce: "n", identity: { ...identity, name: " " }, ticketKind: "unmatched" }, Date.now());
    const login = signIn({ kind: "dismissed" });
    await render(<ContinueFlow />);
    await act(async () => fireEvent.press(screen.getByTestId("choice-create")));
    await act(async () => fireEvent.changeText(screen.getByTestId("choice-name"), "a".repeat(101)));
    await act(async () => fireEvent(screen.getByTestId("choice-name"), "submitEditing"));
    expect(screen.getByText(viText("auth.continue.create.displayNameTooLong", { max: 100 }))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("choice-name"), "An"));
    await act(async () => fireEvent(screen.getByTestId("choice-name"), "submitEditing"));
    expect(login).toHaveBeenCalledWith({ method: "ticket", displayName: "An" });
  });

  it("says a choice that ran out, and goes back to sign in", async () => {
    signIn(transport("sign_in_expired"));
    await render(<ContinueFlow />);
    await act(async () => fireEvent.press(screen.getByTestId("choice-create")));
    expect(screen.getByText(viText("auth.continue.expired.bodyProvider", { provider: "Google" }))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("continue-retry")));
    expect(router.dismissAll).toHaveBeenCalled();
  });

  it("lets back leave once the ticket ran out on a step, by Android's button and the swipe", async () => {
    send.mutateAsync.mockRejectedValueOnce(transport("sign_in_ticket_missing", 404));
    const remove = jest.fn();
    const listen = jest.spyOn(BackHandler, "addEventListener").mockReturnValue({ remove });
    signIn();
    await render(<ContinueFlow />);
    await act(async () => fireEvent.press(screen.getByTestId("choice-invited")));
    expect(useNavigation().setOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
    expect(listen).toHaveBeenCalled();
    await act(async () => fireEvent.changeText(screen.getByTestId("claim-email"), "an@congty.vn"));
    await act(async () => fireEvent.press(screen.getByTestId("claim-send")));
    expect(screen.getByTestId("continue-expired")).toBeTruthy();
    // Nothing is left to step back through: Android's back is let go and the swipe is on again.
    expect(remove).toHaveBeenCalled();
    expect(useNavigation().setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it("says a sign-in ran out without naming a provider it never saw", async () => {
    forgetPendingSignIn();
    signIn();
    await render(<ContinueFlow />);
    expect(screen.getByText(viText("auth.continue.expired.body"))).toBeTruthy();
  });
});

describe("the claim steps", () => {
  it("says an address the server refused under its field, and a code asked too often with its wait", async () => {
    send.mutateAsync
      .mockRejectedValueOnce(transport("invalid_request", 400))
      .mockRejectedValueOnce(transport("rate_limited", 429, { retryAfterMs: 30_000 }));
    const onSent = jest.fn();
    await render(<ClaimEmailStep email="an@congty.vn" onChangeEmail={jest.fn()} onSent={onSent} onRestart={jest.fn()} />);
    await act(async () => fireEvent(screen.getByTestId("claim-email"), "submitEditing"));
    expect(screen.getByText(viText("auth.continue.errors.invalidEmail"))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("claim-send")));
    expect(screen.getByText(new RegExp(viText("auth.continue.errors.tooManyCodes")))).toBeTruthy();
    expect(screen.getByTestId("claim-send")).toBeDisabled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("hands a ticket that is gone to the screen, from the address and from the code", async () => {
    send.mutateAsync.mockRejectedValueOnce(transport("sign_in_ticket_missing", 404));
    const onRestart = jest.fn();
    await render(<ClaimEmailStep email="an@congty.vn" onChangeEmail={jest.fn()} onSent={jest.fn()} onRestart={onRestart} />);
    await act(async () => fireEvent.press(screen.getByTestId("claim-send")));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("mails the code again once the minute is over, and says where", async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const onResent = jest.fn();
    signIn();
    await render(<ClaimCodeStep email="an@congty.vn" resendAtMs={1_030_000} onResent={onResent} onChangeEmail={jest.fn()} onRestart={jest.fn()} />);
    expect(screen.getByText(viText("auth.continue.claim.resendIn", { count: 30 }))).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(30_000));
    await act(async () => fireEvent.press(screen.getByTestId("claim-resend")));
    expect(send.mutateAsync).toHaveBeenCalledWith("an@congty.vn");
    expect(onResent).toHaveBeenCalled();
    expect(screen.getByText(viText("auth.continue.claim.resent", { email: "an@congty.vn" }))).toBeTruthy();
  });

  it("clears a wrong code, takes the button for a full one, and hands a gone ticket on", async () => {
    const login = signIn(transport("invalid_code", 400), transport("sign_in_ticket_missing", 404));
    send.mutateAsync.mockRejectedValueOnce(transport("sign_in_ticket_missing", 404));
    const onRestart = jest.fn();
    await render(<ClaimCodeStep email="an@congty.vn" resendAtMs={0} onResent={jest.fn()} onChangeEmail={jest.fn()} onRestart={onRestart} />);
    await act(async () => fireEvent.press(screen.getByTestId("claim-verify")));
    expect(login).not.toHaveBeenCalled();
    await act(async () => fireEvent.changeText(screen.getByTestId("claim-code"), "123456"));
    expect(screen.getByText(viText("auth.continue.errors.invalidCode"))).toBeTruthy();
    expect(screen.getByTestId("claim-code").props.value).toBe("");
    await act(async () => fireEvent.press(screen.getByTestId("claim-resend")));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
