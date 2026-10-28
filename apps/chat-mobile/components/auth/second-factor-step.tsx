// The second factor of a sign-in (spec §5.2, ADR 0049 §4): the six digits of the authenticator app, sent as soon as
// the sixth arrives, or a recovery code; under the title, whose account it signs in to and the provider it links.
// A wrong code is cleared and its field focused; ten in a row lock the factor, and the field waits while the lock
// counts down (429 second_factor_locked, retry_after). A challenge that is gone (expired, the app restarted) says so,
// with the way back to sign-in, as soon as its five minutes pass: a lock may count down longer than that, and a code
// typed after it could not be sent. Leaving the screen any way (the back button, iOS's edge swipe) drops the challenge.
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View } from "react-native";
import { clearSecondFactor, usePendingSignIn } from "@/data/auth/pending-sign-in";
import { useAuthStore } from "@/data/auth/store";
import { CODE_LENGTH } from "@/lib/sign-in-form";
import { signInRoutes } from "@/lib/sign-in-routes";
import { AuthField } from "./auth-field";
import { AuthHeading, SubmitButton, TextButton } from "./auth-layout";
import { CodeField } from "./code-field";
import { useCountdown } from "./use-countdown";
import { useFailureMessage, useSignIn } from "./use-sign-in";

/** Back to the sign-in screen: the challenge is of no use there. */
export function leaveSecondFactor(): void {
  clearSecondFactor();
  if (router.canGoBack()) router.back();
  else router.replace(signInRoutes.login());
}

export function SecondFactorStep({ linkMode }: { linkMode: boolean }) {
  const { t } = useTranslation();
  const pending = usePendingSignIn((s) => s.secondFactor);
  const linkingProvider = usePendingSignIn((s) => (linkMode ? (s.choice?.identity.provider ?? null) : null));
  const signIn = useSignIn("second_factor", { linkMode });
  const { message, spoken, waiting } = useFailureMessage(signIn.shown);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [required, setRequired] = useState(false);
  const input = useRef<TextInput>(null);
  const busy = signIn.busy !== null;
  const challengeLeft = useCountdown(pending?.expiresAtMs ?? null);
  // The edge swipe leaves without leaveSecondFactor: the challenge goes with the screen all the same.
  useEffect(
    () => () => {
      if (!useAuthStore.getState().user) clearSecondFactor();
    },
    [],
  );

  if (!pending || challengeLeft === 0 || signIn.shown?.failure.kind === "restart") {
    return (
      <View className="gap-6" testID="mfa-expired">
        <AuthHeading title={t("auth.continue.expired.title")} subtitle={t("auth.continue.expired.body")} />
        <SubmitButton label={t("auth.mfa.back")} onPress={leaveSecondFactor} testID="mfa-restart" />
      </View>
    );
  }

  const { email } = pending.context;
  const provider = pending.context.provider ?? linkingProvider;
  const subtitle = !email
    ? t("auth.mfa.subtitle")
    : provider
      ? t("auth.continue.loginMode.mfaSubtitle", { email, provider: t(`auth.social.provider.${provider}`) })
      : t("mobile.sign_in.mfa.subtitle", { email });

  const verify = async (value: string) => {
    const result = await signIn.run({ method: "second_factor", code: value }, "verify");
    if (result && !result.ok) {
      setCode("");
      input.current?.focus();
    }
  };

  const submit = () => {
    if (busy || waiting) return;
    if (recovery ? !code.trim() : code.length < CODE_LENGTH) {
      setRequired(recovery);
      input.current?.focus();
      return;
    }
    void verify(code);
  };

  const switchMode = () => {
    setRecovery((value) => !value);
    setCode("");
    setRequired(false);
    signIn.clearFailure();
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <View className="gap-6">
      <AuthHeading title={t("auth.mfa.title")} subtitle={subtitle} />
      {recovery ? (
        <AuthField
          ref={input}
          label={t("mobile.sign_in.mfa.recovery_label")}
          value={code}
          onChangeText={(next) => {
            setCode(next);
            setRequired(false);
          }}
          error={message ?? (required ? t("mobile.sign_in.mfa.recovery_required") : null)}
          spokenError={spoken}
          hint={t("mobile.sign_in.mfa.recovery_hint")}
          autoCapitalize="none"
          autoComplete="off"
          textContentType="none"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={submit}
          busy={busy}
          editable={!waiting}
          testID="mfa-recovery"
        />
      ) : (
        <CodeField
          ref={input}
          label={t("auth.mfa.codeLabel")}
          value={code}
          onChange={setCode}
          onComplete={(full) => {
            if (!busy && !waiting) void verify(full);
          }}
          error={message}
          spokenError={spoken}
          hint={t("mobile.sign_in.mfa.code_hint")}
          busy={busy}
          disabled={waiting}
          autoFocus
          testID="mfa-code"
        />
      )}
      <SubmitButton
        label={t("auth.mfa.submit")}
        busyLabel={t("auth.mfa.verifying")}
        busy={busy}
        disabled={waiting}
        onPress={submit}
        testID="mfa-submit"
      />
      <View className="items-center">
        <TextButton
          label={t(recovery ? "mobile.sign_in.mfa.use_app" : "mobile.sign_in.mfa.use_recovery")}
          disabled={busy}
          onPress={switchMode}
          testID="mfa-switch"
        />
      </View>
    </View>
  );
}
