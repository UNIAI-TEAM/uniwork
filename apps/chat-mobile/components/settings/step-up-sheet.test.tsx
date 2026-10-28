// "Xác nhận là bạn" on the phone (use-step-up.ts, step-up-sheet.tsx, step-up-proofs.tsx): a held token runs the
// command at once; otherwise the sheet asks for the proof the server's list puts first, with "Dùng cách khác" for the
// rest, and the command runs with the token it bought. Each refusal is said under its field; a lock counts down; a
// token the server refused is asked for once more with the proofs it names. The app lock puts the sheet away and
// brings it back where it was; on iOS the next sheet waits for the last one to finish closing.
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { StepUpAction, StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Text } from "react-native";
import { signInMethodsApi, stepUp, stepUpWithProvider } from "@/data/auth/methods-api";
import { forgetStepUp, holdStepUp } from "@/data/auth/step-up-store";
import { useAuthStore } from "@/data/auth/store";
import { setAppLockEngaged } from "@/data/stores/app-lock-store";
import { finishDismissals, holdDismissals } from "@/test/dismissing-modal";
import { render, viText } from "@/test/render";
import { useStepUp } from "./use-step-up";

jest.mock("react-native/Libraries/Modal/Modal", () => jest.requireActual("@/test/dismissing-modal"));
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("@/data/auth/flow", () => ({ ...jest.requireActual("@/data/auth/flow"), signInOffer: jest.fn(async () => ({ apple: null, google: "native" })) }));
jest.mock("@/data/auth/methods-api", () => ({
  stepUp: jest.fn(),
  stepUpWithProvider: jest.fn(),
  linkProvider: jest.fn(),
  linkPendingTicket: jest.fn(),
  signInMethodsApi: { getSignInMethods: jest.fn(), sendStepUpEmailCode: jest.fn(), setPassword: jest.fn(), unlink: jest.fn() },
}));

const refusal = (code: string, status: number, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), { name: "ApiError", status, body: { error: { code, fields } } });
const methods = (proofs: StepUpProof[]) => ({
  password: { set: true, changed_at: null },
  google: { linked: true, email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs,
});
/** What a passing proof does: the token is held for the account, as data/auth/methods-api.ts › stepUp does. */
const holds = (method: StepUpProof) => async (_proof: unknown, action: StepUpAction, userId: string) => {
  holdStepUp({ step_up_token: `su_${method}`, expires_at: new Date(Date.now() + 600_000).toISOString(), method }, { userId, action });
  return true;
};

interface HarnessProps {
  action: StepUpAction;
  command: (token: string) => Promise<string>;
  proofs?: StepUpProof[];
  insideSheet?: boolean;
}

function Harness({ action, command, proofs, insideSheet = false }: HarnessProps) {
  const gate = useStepUp({ insideSheet });
  const [out, setOut] = useState("");
  return (
    <>
      <Pressable
        accessibilityRole="button"
        testID="run"
        onPress={() =>
          void gate.run(action, command, proofs ? { proofs } : {}).then(
            (result) => setOut(result.done ? `done:${result.value}` : "cancelled"),
            (error: Error) => setOut(`error:${error.message}`),
          )
        }
      >
        <Text>run</Text>
      </Pressable>
      <Text testID="out">{out}</Text>
      {gate.sheet}
    </>
  );
}

const command = jest.fn(async (token: string) => token);
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const open = async (props: { action?: StepUpAction; proofs?: StepUpProof[]; insideSheet?: boolean } = {}) => {
  await render(<Harness action={props.action ?? "unlink_google"} command={command} proofs={props.proofs} insideSheet={props.insideSheet} />);
  await fireEvent.press(screen.getByTestId("run"));
  await settle();
};
const out = () => screen.getByTestId("out").props.children as string;

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.example" });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  useAuthStore.setState({ user: { id: "u1", email: "an@acme.vn", display_name: "An", has_password: true } as never });
  jest.mocked(stepUp).mockImplementation(holds("password"));
  jest.mocked(signInMethodsApi.getSignInMethods).mockResolvedValue(methods(["password", "email_code"]));
});
afterEach(() => {
  finishDismissals();
  setAppLockEngaged(false);
  forgetStepUp();
  resetRuntimeConfig();
  useAuthStore.setState({ user: null });
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("useStepUp and the proof sheet", () => {
  it("runs the command at once with a token held for its action", async () => {
    await holds("password")(null, "unlink_google", "u1");
    await open();
    expect(command).toHaveBeenCalledWith("su_password");
    expect(out()).toBe("done:su_password");
    expect(screen.queryByTestId("step-up-sheet")).toBeNull();
  });

  it("asks for the password first, says what it is for, and runs the command with the token it bought", async () => {
    await open({ proofs: ["password", "email_code"] });
    expect(screen.getByRole("header", { name: viText("settings.security.stepUp.title") })).toBeOnTheScreen();
    const action = viText("settings.security.stepUp.actions.unlink_google");
    expect(screen.getByText(viText("settings.security.stepUp.description", { action }))).toBeOnTheScreen();
    expect(screen.getByText(viText("settings.security.stepUp.windowHint"))).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("step-up-password"), "s3cret");
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    await settle();
    expect(stepUp).toHaveBeenCalledWith({ kind: "password", password: "s3cret" }, "unlink_google", "u1");
    expect(command).toHaveBeenCalledWith("su_password");
    expect(out()).toBe("done:su_password");
  });

  it("refuses an empty password, then says a wrong one under the field and clears it", async () => {
    jest.mocked(stepUp).mockRejectedValueOnce(refusal("password_incorrect", 403));
    await open({ proofs: ["password"] });
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    expect(screen.getByText(viText("settings.security.stepUp.password.required"))).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("step-up-password"), "wrong");
    await fireEvent(screen.getByTestId("step-up-password"), "submitEditing");
    await settle();
    expect(screen.getByText(viText("settings.security.stepUp.errors.passwordIncorrect"))).toBeOnTheScreen();
    expect(screen.getByTestId("step-up-password").props.value).toBe("");
    expect(command).not.toHaveBeenCalled();
  });

  it("opens the web's reset page from Quên mật khẩu?", async () => {
    await open({ proofs: ["password"] });
    await fireEvent.press(screen.getByTestId("step-up-forgot"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/forgot-password");
  });

  it("asks the second factor alone while it is on, sent with its sixth digit, or a recovery code", async () => {
    jest.mocked(stepUp).mockImplementation(holds("totp"));
    await open({ proofs: ["totp"] });
    expect(screen.queryByTestId("step-up-another")).toBeNull();
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    expect(screen.getByText(viText("settings.security.stepUp.totp.required"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("step-up-switch-code"));
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    expect(screen.getByText(viText("mobile.sign_in.mfa.recovery_required"))).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("step-up-recovery"), " abcde-12345 ");
    await fireEvent(screen.getByTestId("step-up-recovery"), "submitEditing");
    await settle();
    expect(stepUp).toHaveBeenCalledWith({ kind: "totp", code: "abcde-12345" }, "unlink_google", "u1");
    expect(out()).toBe("done:su_totp");
  });

  it("sends the authenticator's code as its sixth digit arrives", async () => {
    jest.mocked(stepUp).mockImplementation(holds("totp"));
    await open({ proofs: ["totp"] });
    await fireEvent.press(screen.getByTestId("step-up-switch-code"));
    await fireEvent.press(screen.getByTestId("step-up-switch-code"));
    await fireEvent.changeText(screen.getByTestId("step-up-totp"), "123456");
    await settle();
    expect(stepUp).toHaveBeenCalledWith({ kind: "totp", code: "123456" }, "unlink_google", "u1");
  });

  it("counts a locked factor down, taking nothing meanwhile", async () => {
    jest.mocked(stepUp).mockRejectedValueOnce(refusal("second_factor_locked", 429, { retry_after: 120 }));
    await open({ proofs: ["totp"] });
    await fireEvent.changeText(screen.getByTestId("step-up-totp"), "111111");
    await settle();
    expect(screen.getByText(new RegExp(viText("settings.security.stepUp.errors.locked")))).toBeOnTheScreen();
    expect(screen.getByTestId("step-up-submit")).toBeDisabled();
  });

  it("mails a code for this action alone, then takes it; a second code waits a minute", async () => {
    useAuthStore.setState({ user: { id: "u1", email: "an@gmail.com", display_name: "An", has_password: false } as never });
    jest.mocked(signInMethodsApi.sendStepUpEmailCode).mockResolvedValue(true);
    jest.mocked(stepUp).mockImplementation(holds("email_code"));
    await open({ action: "delete_account", proofs: ["email_code"] });
    const action = viText("settings.security.stepUp.actions.delete_account");
    expect(screen.getByText(viText("mobile.step_up.one_action_hint", { action }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("step-up-send-code"));
    await settle();
    expect(signInMethodsApi.sendStepUpEmailCode).toHaveBeenCalledWith("delete_account");
    expect(screen.getByTestId("step-up-code-sent")).toHaveTextContent(viText("settings.security.stepUp.emailCode.sent", { email: "an@gmail.com" }));
    expect(screen.getByTestId("step-up-resend")).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId("step-up-email-code"), "654321");
    await settle();
    expect(stepUp).toHaveBeenCalledWith({ kind: "email_code", code: "654321" }, "delete_account", "u1");
    expect(out()).toBe("done:su_email_code");
  });

  it("says Apple's relay address by name, and a code asked for too often", async () => {
    useAuthStore.setState({ user: { id: "u1", email: "x@privaterelay.appleid.com", display_name: "", has_password: false } as never });
    jest.mocked(signInMethodsApi.sendStepUpEmailCode).mockRejectedValueOnce(refusal("rate_limited", 429, { retry_after: 3600 }));
    await open({ proofs: ["email_code"] });
    expect(screen.getByText(viText("settings.security.stepUp.emailCode.relayHint"))).toBeOnTheScreen();
    expect(screen.getByText(viText("settings.security.stepUp.emailCode.sendRelay"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("step-up-send-code"));
    await settle();
    expect(screen.getByText(new RegExp(viText("settings.security.stepUp.errors.tooManyCodes")))).toBeOnTheScreen();
    expect(screen.queryByTestId("step-up-code-sent")).toBeNull();
  });

  it("lists the other ways, and proves with Google's own sheet", async () => {
    jest.mocked(stepUpWithProvider).mockImplementation(async (_provider, action, userId) => {
      await holds("google")(null, action, userId);
      return "held";
    });
    await open({ proofs: ["password", "google", "email_code"] });
    await settle();
    await fireEvent.press(screen.getByTestId("step-up-another"));
    expect(screen.getByTestId("step-up-ways")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("step-up-way-google"));
    expect(screen.getByText(viText("settings.security.stepUp.provider.hint", { provider: "Google" }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("step-up-google"));
    await settle();
    expect(stepUpWithProvider).toHaveBeenCalledWith("google", "unlink_google", "u1");
    expect(out()).toBe("done:su_google");
  });

  it("says Google's own sheet failing, and nothing when it was closed", async () => {
    jest.mocked(stepUpWithProvider).mockResolvedValueOnce("dismissed").mockRejectedValueOnce(new Error("ERR_GOOGLE_SIGN_IN"));
    await open({ proofs: ["google", "email_code"] });
    await settle();
    await fireEvent.press(screen.getByTestId("step-up-google"));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    await fireEvent.press(screen.getByTestId("step-up-google"));
    await settle();
    expect(screen.getByText(viText("auth.social.errors.google_failed"))).toBeOnTheScreen();
  });

  it("asks for the proof the server now takes (two-factor turned on elsewhere)", async () => {
    jest.mocked(stepUp).mockRejectedValueOnce(refusal("proof_required", 403, { proofs: ["totp"] }));
    await open({ proofs: ["password"] });
    await fireEvent.changeText(screen.getByTestId("step-up-password"), "pw");
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    await settle();
    expect(screen.getByTestId("step-up-totp")).toBeOnTheScreen();
  });

  it("reads the proofs from the sign-in methods when the command names none", async () => {
    jest.mocked(signInMethodsApi.getSignInMethods).mockResolvedValueOnce(methods(["email_code"]));
    await open();
    expect(signInMethodsApi.getSignInMethods).toHaveBeenCalled();
    expect(screen.getByTestId("step-up-send-code")).toBeOnTheScreen();
  });

  it("asks once more when the server refused the held token, then lets a second refusal through", async () => {
    await holds("password")(null, "unlink_google", "u1");
    command
      .mockImplementationOnce(async () => {
        forgetStepUp();
        throw refusal("proof_required", 403, { proofs: ["password"] });
      })
      .mockImplementationOnce(async () => {
        throw refusal("proof_required", 403, { proofs: ["password"] });
      });
    await open();
    expect(screen.getByTestId("step-up-password")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("step-up-password"), "pw");
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    await settle();
    expect(command).toHaveBeenCalledTimes(2);
    expect(out()).toBe("error:proof_required");
  });

  it("answers not done when the person cancels, and lets any other refusal of the command through", async () => {
    await open({ proofs: ["password"] });
    await fireEvent.press(screen.getByTestId("step-up-cancel"));
    await settle();
    expect(out()).toBe("cancelled");
    expect(command).not.toHaveBeenCalled();
    command.mockRejectedValueOnce(refusal("sign_in_method_last", 409));
    await holds("password")(null, "unlink_google", "u1");
    await fireEvent.press(screen.getByTestId("run"));
    await settle();
    expect(out()).toBe("error:sign_in_method_last");
  });

  it("chooses from the account's own state when the methods cannot be read, and runs nothing for nobody", async () => {
    jest.mocked(signInMethodsApi.getSignInMethods).mockRejectedValueOnce(new Error("offline"));
    await open();
    expect(screen.getByTestId("step-up-password")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("step-up-cancel"));
    await settle();
    await act(async () => useAuthStore.setState({ user: null }));
    await fireEvent.press(screen.getByTestId("run"));
    await settle();
    expect(out()).toBe("cancelled");
    expect(screen.queryByTestId("step-up-password")).toBeNull();
  });

  it("answers not done when the screen goes away with the sheet open", async () => {
    const { unmount } = await render(<Harness action="unlink_google" command={command} proofs={["password"]} />);
    await fireEvent.press(screen.getByTestId("run"));
    await settle();
    await act(async () => unmount());
    expect(command).not.toHaveBeenCalled();
  });

  it("closes as not done when a proof passed but left no token for this action", async () => {
    jest.mocked(stepUp).mockImplementationOnce(async (_proof, _action, userId) => {
      // A mailed code bought for another action serves only that one.
      holdStepUp({ step_up_token: "su_x", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "email_code" }, { userId, action: "link_apple" });
      return true;
    });
    await open({ proofs: ["password"] });
    await fireEvent.changeText(screen.getByTestId("step-up-password"), "pw");
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    await settle();
    expect(out()).toBe("cancelled");
    expect(command).not.toHaveBeenCalled();
  });

  it("says a proof that came back without a usable token", async () => {
    jest.mocked(stepUp).mockResolvedValueOnce(false);
    await open({ proofs: ["password"] });
    await fireEvent.changeText(screen.getByTestId("step-up-password"), "pw");
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    await settle();
    expect(screen.getByText(viText("settings.security.stepUp.errors.generic"))).toBeOnTheScreen();
  });

  it("says when this phone can present none of the proofs the server takes", async () => {
    await open({ proofs: ["apple"] });
    await settle();
    expect(screen.getByTestId("step-up-unavailable")).toHaveTextContent(viText("mobile.step_up.unavailable"));
  });
});

describe("the proof sheet, the app lock and the sheet before it", () => {
  const byMail = () => {
    useAuthStore.setState({ user: { id: "u1", email: "an@gmail.com", display_name: "An", has_password: false } as never });
    jest.mocked(signInMethodsApi.sendStepUpEmailCode).mockResolvedValue(true);
    jest.mocked(stepUp).mockImplementation(holds("email_code"));
  };
  const lock = (engaged: boolean) => act(async () => setAppLockEngaged(engaged));

  it("is put away under the lock and comes back on the code it mailed, without mailing another", async () => {
    byMail();
    await open({ action: "link_google", proofs: ["email_code"] });
    await fireEvent.press(screen.getByTestId("step-up-send-code"));
    await settle();
    // The person left for Mail; the lock engaged on the way back.
    await lock(true);
    expect(screen.queryByTestId("step-up-sheet")).toBeNull();
    expect(out()).toBe("");
    await lock(false);
    expect(screen.getByTestId("step-up-code-sent")).toBeOnTheScreen();
    expect(screen.getByTestId("step-up-resend")).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId("step-up-email-code"), "654321");
    await settle();
    expect(signInMethodsApi.sendStepUpEmailCode).toHaveBeenCalledTimes(1);
    expect(out()).toBe("done:su_email_code");
  });

  it("keeps the proof chosen with Dùng cách khác, and a proof under way, through the lock", async () => {
    let answer: (result: "held") => void = () => undefined;
    jest.mocked(stepUpWithProvider).mockImplementationOnce(async (_provider, action, userId) => {
      await new Promise<"held">((resolve) => (answer = resolve));
      await holds("google")(null, action, userId);
      return "held";
    });
    await open({ proofs: ["password", "google"] });
    await settle();
    await fireEvent.press(screen.getByTestId("step-up-another"));
    await fireEvent.press(screen.getByTestId("step-up-way-google"));
    await lock(true);
    await lock(false);
    expect(screen.getByTestId("step-up-google")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("step-up-google"));
    // Google's sheet paused the app and the lock engaged meanwhile: the busy sheet goes away all the same.
    await lock(true);
    expect(screen.queryByTestId("step-up-sheet")).toBeNull();
    await act(async () => answer("held"));
    await settle();
    expect(out()).toBe("done:su_google");
  });

  it("closes under the lock inside another sheet, and opens again for the action on the code already mailed", async () => {
    byMail();
    await open({ action: "delete_account", proofs: ["email_code"], insideSheet: true });
    await fireEvent.press(screen.getByTestId("step-up-send-code"));
    await settle();
    await lock(true);
    await settle();
    expect(out()).toBe("cancelled");
    await lock(false);
    await fireEvent.press(screen.getByTestId("run"));
    await settle();
    expect(screen.getByTestId("step-up-code-sent")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("step-up-email-code"), "654321");
    await settle();
    expect(signInMethodsApi.sendStepUpEmailCode).toHaveBeenCalledTimes(1);
    expect(out()).toBe("done:su_email_code");
  });

  it("mails again for an action whose code bought its token", async () => {
    byMail();
    await open({ action: "delete_account", proofs: ["email_code"] });
    await fireEvent.press(screen.getByTestId("step-up-send-code"));
    await settle();
    await fireEvent.changeText(screen.getByTestId("step-up-email-code"), "654321");
    await settle();
    forgetStepUp();
    await fireEvent.press(screen.getByTestId("run"));
    await settle();
    expect(screen.getByTestId("step-up-send-code")).toBeOnTheScreen();
  });

  /** Two holds, as the owner's hand-over asks them; `between` is the wait in between (the methods read again). */
  function Chain({ between }: { between: () => Promise<void> }) {
    const gate = useStepUp();
    const [out, setOut] = useState("");
    const chain = async () => {
      const first = await gate.hold("transfer_ownership");
      await between();
      setOut(`${first}:${await gate.hold("delete_account")}`);
    };
    return (
      <>
        <Pressable accessibilityRole="button" testID="chain" onPress={() => void chain()}>
          <Text>chain</Text>
        </Pressable>
        <Text testID="out">{out}</Text>
        {gate.sheet}
      </>
    );
  }
  const describes = (action: StepUpAction) =>
    viText("settings.security.stepUp.description", { action: viText(`settings.security.stepUp.actions.${action}`) });

  it.each(["ios", "android"] as const)("on %s, presents the next ask once the last sheet is gone", async (os) => {
    const was = Platform.OS;
    Platform.OS = os;
    try {
      // A mailed code serves its own action only: the second hold needs a sheet of its own.
      jest.mocked(stepUp).mockImplementation(holds("email_code"));
      let goOn: () => void = () => undefined;
      await render(<Chain between={() => new Promise<void>((resolve) => (goOn = resolve))} />);
      await fireEvent.press(screen.getByTestId("chain"));
      await settle();
      expect(screen.getByText(describes("transfer_ownership"))).toBeOnTheScreen();
      holdDismissals();
      await fireEvent.changeText(screen.getByTestId("step-up-password"), "pw");
      await fireEvent.press(screen.getByTestId("step-up-submit"));
      await settle();
      expect(screen.queryByTestId("step-up-sheet")).toBeNull();
      // The second ask comes while the first sheet is still sliding away.
      await act(async () => goOn());
      await settle();
      if (os === "ios") {
        // iOS cannot present over a sheet that is still closing: the second waits for its onDismiss.
        expect(screen.queryByTestId("step-up-sheet")).toBeNull();
        await act(async () => finishDismissals());
      }
      expect(screen.getByText(describes("delete_account"))).toBeOnTheScreen();
      await fireEvent.changeText(screen.getByTestId("step-up-password"), "pw");
      await fireEvent.press(screen.getByTestId("step-up-submit"));
      await settle();
      expect(screen.getByTestId("out").props.children).toBe("true:true");
    } finally {
      Platform.OS = was;
    }
  });
});
