// "Xác nhận là bạn" and Settings › Sign-in methods on the phone (ADR 0047 §5-6, spec §5.2): one proof for a step-up
// token, a code mailed for one action, setting or changing the password, unlinking, and linking with the provider's
// own sheet. Every command that rides the held token forgets it when the server refuses it (withHeldStepUp), so the
// proof sheet asks again with the proofs the refusal names. An answer's user replaces the signed-in one (read again
// from /me when it did not parse; never a guess), and its methods replace the section's. See command.ts.
import type { QueryClient } from "@tanstack/react-query";
import type { StepUpProofInput } from "@uniwork/core/api/endpoints/sign-in-methods-api";
import type { SignInMethodsChange, SignInProvider, StepUpAction } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { api } from "../api";
import { linkProvider, signInMethodsApi, stepUp, stepUpWithProvider } from "../auth/methods-api";
import { withHeldStepUp } from "../auth/step-up-store";
import { useAuthStore } from "../auth/store";
import { signInKeys } from "../queries/sign-in";
import { bestEffort } from "../report";
import { useCommand } from "./command";

/** One proof as the sheet collects it: a provider's comes from its own sheet, opened by the command. */
export type ProofEntry = Exclude<StepUpProofInput, { kind: "provider" }> | { kind: "provider"; provider: SignInProvider };

/** The refusals the proof sheet says under its field (core's readSignInFailure, context step_up). */
const PROOF_CODES = [
  "password_incorrect",
  "mfa_code_incorrect",
  "step_up_code_incorrect",
  "provider_token_invalid",
  "second_factor_locked",
  "rate_limited",
  "proof_required",
] as const;

/** What a command that changed how the account signs in leaves behind. */
async function applied(qc: QueryClient, change: SignInMethodsChange): Promise<SignInMethodsChange> {
  if (change.methods) qc.setQueryData(signInKeys.methods(), change.methods);
  else void qc.invalidateQueries({ queryKey: signInKeys.methods() });
  const user = change.user ?? (await api.getMe().catch(bestEffort("sign-in-methods", "user not read again", "breadcrumb")));
  if (user) useAuthStore.getState().setUser(user);
  return change;
}

/** `held` once the proof bought a token for the action; `dismissed` when a provider's sheet was closed. */
export const useStepUpProof = () =>
  useCommand(
    "sign_in.step_up",
    async (_qc, input: { proof: ProofEntry; action: StepUpAction; userId: string }): Promise<"held" | "unusable" | "dismissed"> => {
      const { proof, action, userId } = input;
      if (proof.kind === "provider") return stepUpWithProvider(proof.provider, action, userId);
      return (await stepUp(proof, action, userId)) ? "held" : "unusable";
    },
    { handledCodes: PROOF_CODES },
  );

/** Mails a six-digit code that proves `action` alone; true when the server said sent. */
export const useSendStepUpCode = () =>
  useCommand("sign_in.step_up_code", (_qc, action: StepUpAction) => signInMethodsApi.sendStepUpEmailCode(action), {
    handledCodes: ["rate_limited", "proof_required"],
  });

/**
 * Sets the first password, or changes it. The held token proves it when there is one; otherwise the current
 * password does (an account without a second factor). A change signs every other session out (the server decides).
 */
export const useSetPassword = () =>
  useCommand(
    "sign_in.set_password",
    (qc, input: { newPassword: string; currentPassword?: string; stepUpToken?: string }) =>
      withHeldStepUp(async () =>
        applied(
          qc,
          await signInMethodsApi.setPassword(
            input.stepUpToken
              ? { new_password: input.newPassword, step_up_token: input.stepUpToken }
              : { new_password: input.newPassword, current_password: input.currentPassword },
          ),
        ),
      ),
    { handledCodes: ["proof_required", "password_incorrect", "invalid_request", "second_factor_locked"] },
  );

/** Never the last way in, never Apple of a relay account (409); signs every other session out. */
export const useUnlinkSignInMethod = () =>
  useCommand(
    "sign_in.unlink",
    (qc, input: { provider: SignInProvider; stepUpToken: string }) =>
      withHeldStepUp(async () => applied(qc, await signInMethodsApi.unlink(input.provider, input.stepUpToken))),
    { handledCodes: ["proof_required", "sign_in_method_last", "sign_in_method_relay_email"] },
  );

/** The provider's own sheet, then its account into this one; null when the sheet was closed. */
export const useLinkSignInMethod = () =>
  useCommand(
    "sign_in.link",
    (qc, input: { provider: SignInProvider; stepUpToken: string; move?: boolean }) =>
      withHeldStepUp(async () => {
        const change = await linkProvider(input);
        return change && applied(qc, change);
      }),
    {
      handledCodes: [
        "proof_required",
        "sign_in_method_taken",
        "sign_in_method_movable",
        "sign_in_method_already_linked",
        "sign_in_account_conflict",
        "provider_token_invalid",
        "email_unverified",
        "google_not_configured",
        "apple_not_configured",
      ],
    },
  );
