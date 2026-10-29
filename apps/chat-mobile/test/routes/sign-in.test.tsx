// The app's own sign-in screens as the router runs them (spec §5.2): the sign-in screen with its providers and its
// form, the second factor, the choice screen and its "invited with another address" steps, link mode and the link
// step, the register screen, and the verification an account owes before any workspace. The auth store's login is
// a stand-in that answers as each door would (data/auth/sign-in.ts has its own tests); what it is asked, where the
// router lands and what the screen says are what these hold.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import AppLayout from "@/app/(app)/_layout";
import AccountSettings from "@/app/(app)/account";
import LinkSignIn from "@/app/(app)/link-sign-in";
import SelectWorkspace from "@/app/(app)/select-workspace";
import VerifyEmail from "@/app/(app)/verify-email";
import AuthLayout from "@/app/(auth)/_layout";
import Continue from "@/app/(auth)/continue";
import Login from "@/app/(auth)/login";
import SecondFactor from "@/app/(auth)/mfa";
import Register from "@/app/(auth)/register";
import Index from "@/app/index";
import { accountApi } from "@/data/account-api";
import { api } from "@/data/api";
import { signInOffer } from "@/data/auth/flow";
import { linkPendingTicket } from "@/data/auth/methods-api";
import { clearChoice, forgetPendingSignIn, holdStep, usePendingSignIn } from "@/data/auth/pending-sign-in";
import { sendClaimCode, type SignInOutcome, type SignInRequest } from "@/data/auth/sign-in";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { EMPTY_UNREAD_SUMMARY } from "@uniwork/core/api/endpoints/chat-schemas";
import type { SignInIdentity } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { renderRoutes } from "@/test/route-render";
import { viText } from "@/test/render";

jest.unmock("expo-router");
jest.mock("expo-notifications", () => ({ ...jest.requireActual("expo-notifications"), addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("expo-apple-authentication", () => {
  const { Pressable, Text: RNText } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: ({ onPress, buttonType }: { onPress: () => void; buttonType: number }) => (
      <Pressable accessibilityRole="button" testID="apple-native-button" onPress={onPress}>
        <RNText>{`Apple ${buttonType}`}</RNText>
      </Pressable>
    ),
  };
});
jest.mock("@/data/auth/flow", () => ({
  ...jest.requireActual("@/data/auth/flow"),
  signInOffer: jest.fn(async () => ({ apple: "native", google: "native" })),
}));
jest.mock("@/data/auth/sign-in", () => ({ ...jest.requireActual("@/data/auth/sign-in"), sendClaimCode: jest.fn(async () => true) }));
jest.mock("@/data/auth/methods-api", () => ({ ...jest.requireActual("@/data/auth/methods-api"), linkPendingTicket: jest.fn() }));
jest.mock("expo-web-browser", () => ({ ...jest.requireActual("expo-web-browser"), openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));

const ChatStandIn = () => <Text testID="chat-tab">chat</Text>;
const ROUTES = {
  index: Index,
  "(auth)/_layout": AuthLayout,
  "(auth)/login": Login,
  "(auth)/mfa": SecondFactor,
  "(auth)/continue": Continue,
  "(auth)/register": Register,
  "(app)/_layout": AppLayout,
  "(app)/select-workspace": SelectWorkspace,
  "(app)/verify-email": VerifyEmail,
  "(app)/link-sign-in": LinkSignIn,
  "(app)/account": AccountSettings,
  "(app)/[org]/[ws]/chat": ChatStandIn,
};

const NOW = Date.now();
const user = { id: "u1", email: "an@example.com", display_name: "An", email_verified_at: "2026-10-01T00:00:00Z" };
const googleIdentity = { provider: "google" as const, email: "an@gmail.com", name: "An Nguyễn", private_relay: false };
const SIGNED_IN: SignInOutcome = { kind: "signed_in", reclaimed: false, linkSkipped: null };

/** The store's login, answering in turn; a session signs the person in as the store would. */
function answers(...outcomes: (SignInOutcome | Error | ((request: SignInRequest) => SignInOutcome))[]) {
  const login = jest.fn(async (request: SignInRequest = { method: "browser" }): Promise<SignInOutcome> => {
    const next = outcomes.shift() ?? { kind: "dismissed" };
    if (next instanceof Error) throw next;
    const outcome = typeof next === "function" ? next(request) : next;
    if (outcome.kind === "signed_in") {
      // As runSignIn: a session from the choice screen's own ways spends its ticket before the person is loaded.
      if (request.method === "ticket" || request.method === "email_claim") clearChoice();
      useAuthStore.setState({ user: user as never });
    }
    return outcome;
  });
  useAuthStore.setState({ user: null, isLoading: false, login });
  return login;
}

const refusal = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), { name: "TransportError", code, status, fromServer: true, ...extra });

const realLogin = useAuthStore.getState().login;

beforeEach(() => {
  jest.spyOn(api, "listWorkspaces").mockResolvedValue([]);
  jest.spyOn(chatApi, "unreadSummary").mockResolvedValue(EMPTY_UNREAD_SUMMARY);
});

afterEach(async () => {
  await cleanup();
  forgetPendingSignIn();
  usePendingSignIn.setState({ interrupted: null });
  useAuthStore.setState({ user: null, isLoading: true, login: realLogin });
  jest.mocked(signInOffer).mockResolvedValue({ apple: "native", google: "native" });
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the sign-in screen", () => {
  it("leads with Apple then Google on an iPhone, then the form, and starts each provider's own sheet", async () => {
    const login = answers({ kind: "dismissed" }, { kind: "dismissed" });
    await renderRoutes(ROUTES, "/login");
    expect(screen.getByText(viText("mobile.sign_in.title"))).toBeTruthy();
    const apple = await screen.findByTestId("apple-native-button");
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf("apple-native-button")).toBeLessThan(tree.indexOf("google-sign-in"));
    expect(tree.indexOf("google-sign-in")).toBeLessThan(tree.indexOf("login-button"));
    await act(async () => fireEvent.press(apple));
    expect(login).toHaveBeenLastCalledWith({ method: "apple" });
    await act(async () => fireEvent.press(screen.getByTestId("google-sign-in")));
    expect(login).toHaveBeenLastCalledWith({ method: "google" });
  });

  it("checks the form before a round trip, then signs in and leaves for the app", async () => {
    const login = answers(SIGNED_IN);
    const routes = await renderRoutes(ROUTES, "/login");
    await act(async () => fireEvent.press(await screen.findByTestId("login-button")));
    expect(screen.getByText(viText("auth.emailRequired"))).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
    await act(async () => fireEvent.changeText(screen.getByTestId("login-email"), "an@example"));
    await act(async () => fireEvent.press(screen.getByTestId("login-button")));
    expect(screen.getByText(viText("auth.emailInvalid"))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("login-email"), " an@example.com "));
    await act(async () => fireEvent.changeText(screen.getByTestId("login-password"), "secret pw"));
    await act(async () => fireEvent.press(screen.getByTestId("login-button")));
    expect(login).toHaveBeenCalledWith({ method: "password", email: " an@example.com ", password: "secret pw" });
    await waitFor(() => expect(routes.pathname()).toBe("/select-workspace"));
  });

  it("says a wrong password in one line, empties the password and keeps the address", async () => {
    answers(refusal("invalid_credentials", 401));
    await renderRoutes(ROUTES, "/login");
    await act(async () => fireEvent.changeText(await screen.findByTestId("login-email"), "an@example.com"));
    await act(async () => fireEvent.changeText(screen.getByTestId("login-password"), "wrong"));
    await act(async () => fireEvent.press(screen.getByTestId("login-button")));
    expect(screen.getByText(viText("auth.social.errors.invalid_credentials"))).toBeTruthy();
    expect(screen.getByTestId("login-password").props.value).toBe("");
    expect(screen.getByTestId("login-email").props.value).toBe("an@example.com");
  });

  it("hides the providers the server or the phone does not offer, and offers the browser for the rest", async () => {
    jest.mocked(signInOffer).mockResolvedValue({ apple: null, google: null });
    const login = answers({ kind: "dismissed" });
    await renderRoutes(ROUTES, "/login");
    expect(await screen.findByTestId("login-button")).toBeTruthy();
    expect(screen.queryByTestId("provider-buttons")).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId("login-browser")));
    expect(login).toHaveBeenCalledWith({ method: "browser" });
  });

  it("sends a provider the phone has no sheet for through the browser with its hint", async () => {
    jest.mocked(signInOffer).mockResolvedValue({ apple: "browser", google: null });
    const login = answers({ kind: "dismissed" });
    await renderRoutes(ROUTES, "/login");
    await act(async () => fireEvent.press(await screen.findByTestId("apple-browser-sign-in")));
    expect(login).toHaveBeenCalledWith({ method: "browser", provider: "apple" });
  });

  it("tells the next open a choice the app was closed on, and starts that provider again", async () => {
    const login = answers({ kind: "dismissed" });
    usePendingSignIn.setState({ interrupted: "apple" });
    await renderRoutes(ROUTES, "/login");
    expect(await screen.findByText(viText("auth.continue.expired.bodyProvider", { provider: "Apple" }))).toBeTruthy();
    await act(async () => fireEvent.press(await screen.findByTestId("login-interrupted-retry")));
    expect(login).toHaveBeenCalledWith({ method: "apple" });
    expect(usePendingSignIn.getState().interrupted).toBeNull();
    expect(screen.queryByTestId("login-interrupted")).toBeNull();
  });
});

describe("the second factor", () => {
  it("opens after a password that needs one, names the account, and sends the code once all six digits are in", async () => {
    const login = answers(
      () => {
        holdStep({ kind: "mfa", token: "mfa_1", context: { method: "password", email: "an@example.com", provider: null } }, NOW);
        return { kind: "second_factor" };
      },
      SIGNED_IN,
    );
    const routes = await renderRoutes(ROUTES, "/login");
    await act(async () => fireEvent.changeText(await screen.findByTestId("login-email"), "an@example.com"));
    await act(async () => fireEvent.changeText(screen.getByTestId("login-password"), "pw"));
    await act(async () => fireEvent.press(screen.getByTestId("login-button")));
    expect(await screen.findByText(viText("mobile.sign_in.mfa.subtitle", { email: "an@example.com" }))).toBeTruthy();
    expect(routes.pathname()).toBe("/mfa");
    await act(async () => fireEvent.changeText(screen.getByTestId("mfa-code"), "12 34 56"));
    expect(login).toHaveBeenLastCalledWith({ method: "second_factor", code: "123456" });
    await waitFor(() => expect(routes.pathname()).toBe("/select-workspace"));
  });

  it("waits out a lock with a countdown, and takes a recovery code instead", async () => {
    holdStep({ kind: "mfa", token: "mfa_1", context: { method: "google", email: "an@gmail.com", provider: "google" } }, NOW);
    const login = answers(refusal("second_factor_locked", 429, { retryAfterMs: 120_000 }), refusal("invalid_credentials", 401));
    await renderRoutes(ROUTES, "/mfa");
    expect(screen.getByText(viText("auth.continue.loginMode.mfaSubtitle", { email: "an@gmail.com", provider: "Google" }))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("mfa-code"), "000000"));
    expect(screen.getByText(new RegExp(viText("auth.social.errors.second_factor_locked")))).toBeTruthy();
    expect(screen.getByTestId("mfa-code").props.editable).toBe(false);
    await act(async () => fireEvent.press(screen.getByTestId("mfa-switch")));
    await act(async () => fireEvent.press(screen.getByTestId("mfa-submit")));
    expect(screen.getByText(viText("mobile.sign_in.mfa.recovery_required"))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("mfa-recovery"), "abcde-12345"));
    await act(async () => fireEvent.press(screen.getByTestId("mfa-submit")));
    expect(login).toHaveBeenLastCalledWith({ method: "second_factor", code: "abcde-12345" });
    expect(screen.getByText(viText("auth.social.errors.second_factor_invalid"))).toBeTruthy();
  });

  it("says a challenge that is gone, with the way back to sign-in", async () => {
    answers();
    await renderRoutes(ROUTES, "/mfa");
    expect(screen.getByTestId("mfa-expired")).toBeTruthy();
    expect(screen.getByText(viText("auth.continue.expired.title"))).toBeTruthy();
  });
});

describe("the choice screen", () => {
  const holdChoice = (identity: SignInIdentity = googleIdentity, ticketKind: "unmatched" | "link_required" = "unmatched") =>
    holdStep({ kind: "choice", ticket: "t_1", nonce: "n_1", identity, ticketKind }, NOW);

  it("opens on a Google identity no account matched, with the app's order of ways, and creates the account", async () => {
    const login = answers(() => {
      holdChoice();
      return { kind: "choice" };
    }, SIGNED_IN);
    const routes = await renderRoutes(ROUTES, "/login");
    await act(async () => fireEvent.press(await screen.findByTestId("google-sign-in")));
    expect(await screen.findByText(viText("auth.continue.title", { provider: "Google" }))).toBeTruthy();
    expect(routes.pathname()).toBe("/continue");
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf("choice-invited")).toBeLessThan(tree.indexOf("choice-existing"));
    expect(tree.indexOf("choice-existing")).toBeLessThan(tree.indexOf("choice-create"));
    expect(screen.getByText("an@gmail.com")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("choice-create")));
    expect(login).toHaveBeenLastCalledWith({ method: "ticket" });
    await waitFor(() => expect(routes.pathname()).toBe("/select-workspace"));
  });

  it("asks a name for an Apple identity that shared none, and says Apple's hidden email", async () => {
    holdChoice({ provider: "apple", email: "q7@privaterelay.appleid.com", name: "", private_relay: true });
    const login = answers(refusal("sign_in_account_conflict", 409));
    await renderRoutes(ROUTES, "/continue");
    expect(screen.getAllByText(viText("auth.apple.relayEmail")).length).toBeGreaterThan(0);
    expect(screen.getByText(viText("auth.continue.relayHint"))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("choice-create")));
    expect(login).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId("choice-create-submit")));
    expect(screen.getByText(viText("auth.continue.create.displayNameRequired"))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("choice-name"), "Quang"));
    await act(async () => fireEvent.press(screen.getByTestId("choice-create-submit")));
    expect(login).toHaveBeenCalledWith({ method: "ticket", displayName: "Quang" });
    // The address took an account meanwhile: the screen becomes the sign-in-to-link one, its one way on.
    expect(screen.getByText(viText("auth.continue.linkRequired.title"))).toBeTruthy();
    expect(screen.getByTestId("continue-link-required")).toBeTruthy();
    expect(screen.queryByTestId("choice-create")).toBeNull();
  });

  it("mails a code to the invited address and signs in with it", async () => {
    holdChoice();
    const login = answers(SIGNED_IN);
    const routes = await renderRoutes(ROUTES, "/continue");
    await act(async () => fireEvent.press(screen.getByTestId("choice-invited")));
    await act(async () => fireEvent.press(screen.getByTestId("claim-send")));
    expect(screen.getByText(viText("auth.emailRequired"))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("claim-email"), "an@congty.vn"));
    await act(async () => fireEvent.press(screen.getByTestId("claim-send")));
    expect(sendClaimCode).toHaveBeenCalledWith("an@congty.vn");
    expect(await screen.findByText(viText("auth.continue.claim.codeBody", { email: "an@congty.vn" }))).toBeTruthy();
    expect(screen.getByTestId("claim-resend")).toBeDisabled();
    await act(async () => fireEvent.changeText(screen.getByTestId("claim-code"), "654321"));
    expect(login).toHaveBeenCalledWith({ method: "email_claim", email: "an@congty.vn", code: "654321" });
    await waitFor(() => expect(routes.pathname()).toBe("/select-workspace"));
  });

  it("goes back a step from the code to the address, and says a ticket that ran out", async () => {
    holdChoice();
    answers(refusal("sign_in_ticket_missing", 404));
    await renderRoutes(ROUTES, "/continue");
    await act(async () => fireEvent.press(screen.getByTestId("choice-invited")));
    await act(async () => fireEvent.changeText(screen.getByTestId("claim-email"), "an@congty.vn"));
    await act(async () => fireEvent.press(screen.getByTestId("claim-send")));
    await act(async () => fireEvent.press(await screen.findByTestId("claim-change-email")));
    expect(screen.getByTestId("claim-email-step")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("claim-send")));
    await act(async () => fireEvent.changeText(await screen.findByTestId("claim-code"), "111111"));
    expect(await screen.findByTestId("continue-expired")).toBeTruthy();
    expect(screen.getByText(viText("auth.continue.expired.bodyProvider", { provider: "Google" }))).toBeTruthy();
  });

  it("signs in to an account the person has, hides that provider's button, and links on the link step", async () => {
    holdChoice();
    jest.mocked(linkPendingTicket).mockResolvedValueOnce({ user: null, methods: null });
    const login = answers(SIGNED_IN);
    const routes = await renderRoutes(ROUTES, "/continue");
    await act(async () => fireEvent.press(screen.getByTestId("choice-existing")));
    expect(await screen.findByText(viText("auth.continue.loginMode.banner", { provider: "Google", email: "an@gmail.com" }))).toBeTruthy();
    expect(routes.pathname()).toBe("/login");
    expect(screen.queryByTestId("google-sign-in")).toBeNull();
    expect(screen.queryByTestId("login-register")).toBeNull();
    await act(async () => fireEvent.changeText(screen.getByTestId("login-email"), "an@example.com"));
    await act(async () => fireEvent.changeText(screen.getByTestId("login-password"), "pw"));
    await act(async () => fireEvent.press(screen.getByTestId("login-button")));
    expect(login).toHaveBeenCalledWith({ method: "password", email: "an@example.com", password: "pw" });
    expect(await screen.findByTestId("link-ask")).toBeTruthy();
    expect(routes.pathname()).toBe("/link-sign-in");
    expect(
      screen.getByText(viText("auth.continue.link.question", { provider: "Google", providerEmail: "an@gmail.com", accountEmail: "an@example.com" })),
    ).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(linkPendingTicket).toHaveBeenCalledWith({ userId: "u1", move: false });
    expect(await screen.findByText(viText("auth.continue.link.done", { provider: "Google" }))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("link-continue")));
    await waitFor(() => expect(routes.pathname()).toBe("/select-workspace"));
  });

  it("still ends on the link step when the person went back to the choice screen while the sign-in ran", async () => {
    holdChoice();
    let finish: (outcome: SignInOutcome) => void = () => undefined;
    const login = jest.fn(() => new Promise<SignInOutcome>((resolve) => (finish = resolve)));
    useAuthStore.setState({ user: null, isLoading: false, login });
    const routes = await renderRoutes(ROUTES, "/continue");
    await act(async () => fireEvent.press(screen.getByTestId("choice-existing")));
    // Found outside an act: a waitFor inside one takes the screen's query answers with the act environment off.
    const email = await screen.findByTestId("login-email");
    await act(async () => fireEvent.changeText(email, "an@example.com"));
    await act(async () => fireEvent.changeText(screen.getByTestId("login-password"), "pw"));
    await act(async () => fireEvent.press(screen.getByTestId("login-button")));
    await act(async () => fireEvent.press(screen.getByTestId("auth-back")));
    expect(routes.pathname()).toBe("/continue");
    await act(async () => {
      useAuthStore.setState({ user: user as never });
      finish(SIGNED_IN);
    });
    expect(await screen.findByTestId("link-ask")).toBeTruthy();
    expect(routes.pathname()).toBe("/link-sign-in");
  });

  it("offers to sign in to link when the address has an account, and cancels back to sign-in", async () => {
    holdChoice(googleIdentity, "link_required");
    answers();
    const routes = await renderRoutes(ROUTES, "/continue");
    expect(screen.getByText(viText("auth.continue.linkRequired.title"))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("continue-cancel")));
    expect(usePendingSignIn.getState().choice).toBeNull();
    await waitFor(() => expect(routes.pathname()).toBe("/login"));
  });

  it("fills the account's address on the way to sign in to link it, never Apple's hidden one", async () => {
    holdChoice(googleIdentity, "link_required");
    answers();
    await renderRoutes(ROUTES, "/continue");
    await act(async () => fireEvent.press(screen.getByTestId("continue-link-required")));
    expect(await screen.findByTestId("login-link-mode")).toBeTruthy();
    expect(screen.getByTestId("login-email").props.value).toBe("an@gmail.com");
    expect(screen.getByTestId("login-password").props.autoFocus).toBe(true);
    await cleanup();

    holdChoice({ provider: "apple", email: "q7@privaterelay.appleid.com", name: "", private_relay: true }, "link_required");
    await renderRoutes(ROUTES, "/login?link=1");
    expect(screen.getByTestId("login-email").props.value).toBe("");
  });
});

describe("the link step", () => {
  beforeEach(() => holdStep({ kind: "choice", ticket: "t_1", nonce: "n_1", identity: googleIdentity, ticketKind: "unmatched" }, NOW));

  it("moves an identity off the empty account holding it once the person agrees", async () => {
    const movable = Object.assign(new Error("movable"), { name: "ApiError", status: 409, body: { error: { code: "sign_in_method_movable", fields: { masked_email: "a•••@gmail.com" } } } });
    jest.mocked(linkPendingTicket).mockRejectedValueOnce(movable).mockResolvedValueOnce({ user: null, methods: null });
    useAuthStore.setState({ user: user as never, isLoading: false });
    await renderRoutes(ROUTES, "/link-sign-in");
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(screen.getByText(viText("auth.continue.link.movable", { provider: "Google", masked: "a•••@gmail.com" }))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("link-move-confirm")));
    expect(linkPendingTicket).toHaveBeenLastCalledWith({ userId: "u1", move: true });
    expect(await screen.findByTestId("link-done")).toBeTruthy();
  });

  it("names the account that holds a taken identity, and still goes on", async () => {
    const taken = Object.assign(new Error("taken"), { name: "ApiError", status: 409, body: { error: { code: "sign_in_method_taken", fields: { masked_email: "b•••@gmail.com" } } } });
    jest.mocked(linkPendingTicket).mockRejectedValueOnce(taken);
    useAuthStore.setState({ user: user as never, isLoading: false });
    const routes = await renderRoutes(ROUTES, "/link-sign-in");
    await act(async () => fireEvent.press(screen.getByTestId("link-confirm")));
    expect(screen.getByText(viText("auth.continue.link.taken", { provider: "Google", masked: "b•••@gmail.com" }))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("link-continue")));
    await waitFor(() => expect(routes.pathname()).toBe("/select-workspace"));
  });

  it("declines without linking, and has nothing to link once the choice is gone", async () => {
    useAuthStore.setState({ user: user as never, isLoading: false });
    await renderRoutes(ROUTES, "/link-sign-in");
    await act(async () => fireEvent.press(screen.getByTestId("link-decline")));
    expect(usePendingSignIn.getState().choice).toBeNull();
    await cleanup();
    await renderRoutes(ROUTES, "/link-sign-in");
    expect(screen.getByTestId("link-nothing")).toBeTruthy();
  });
});

describe("a new account", () => {
  it("signs up with the providers' sign_up and with the form, then proves the address before any workspace", async () => {
    const login = answers({ kind: "dismissed" }, (request) => {
      useAuthStore.setState({ user: { ...user, email: "moi@congty.vn", email_verified_at: null } as never });
      expect(request).toEqual({ method: "register", email: "moi@congty.vn", password: "12345678", displayName: "Mới" });
      return { kind: "dismissed" };
    });
    const verify = jest.spyOn(accountApi, "verifyEmail").mockResolvedValue({ ...user, email: "moi@congty.vn" } as never);
    const routes = await renderRoutes(ROUTES, "/login");
    await act(async () => fireEvent.press(await screen.findByTestId("login-register")));
    expect(await screen.findByTestId("register-button")).toBeTruthy();
    expect(screen.getByText(viText("mobile.sign_in.register.subtitle"))).toBeTruthy();
    expect(screen.getByText("Apple 2")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("google-sign-in")));
    expect(login).toHaveBeenLastCalledWith({ method: "google", intent: "sign_up" });
    await act(async () => fireEvent.changeText(screen.getByTestId("register-name"), "Mới"));
    await act(async () => fireEvent.changeText(screen.getByTestId("register-email"), "moi@congty.vn"));
    await act(async () => fireEvent.changeText(screen.getByTestId("register-password"), "1234567"));
    await act(async () => fireEvent.press(screen.getByTestId("register-button")));
    expect(screen.getByText(viText("settings.security.signInMethods.password.tooShort"))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("register-password"), "12345678"));
    await act(async () => fireEvent.press(screen.getByTestId("register-button")));
    expect(await screen.findByTestId("verify-email-step")).toBeTruthy();
    expect(routes.pathname()).toBe("/verify-email");
    expect(screen.getByText(viText("auth.verify.subtitle", { email: "moi@congty.vn" }))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("verify-code"), "246810"));
    expect(verify).toHaveBeenCalledWith("246810");
    await waitFor(() => expect(routes.pathname()).toBe("/select-workspace"));
  });

  it("keeps an unproved account out of the workspaces, and lets it reach Settings or sign out", async () => {
    const logout = jest.fn(async () => undefined);
    useAuthStore.setState({ user: { ...user, email_verified_at: null } as never, isLoading: false, logout });
    jest.spyOn(accountApi, "verifyEmail").mockRejectedValue(Object.assign(new Error("x"), { name: "ApiError", status: 400, body: { error: { code: "invalid_code" } } }));
    const routes = await renderRoutes(ROUTES, "/select-workspace");
    expect(await screen.findByTestId("verify-email-step")).toBeTruthy();
    expect(routes.pathname()).toBe("/verify-email");
    await act(async () => fireEvent.changeText(screen.getByTestId("verify-code"), "000000"));
    expect(screen.getByText(viText("auth.verify.invalidCode"))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("verify-logout")));
    expect(logout).toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId("verify-settings")));
    expect(await screen.findByTestId("settings-delete-account")).toBeTruthy();
    expect(routes.pathname()).toBe("/account");
  });
});
