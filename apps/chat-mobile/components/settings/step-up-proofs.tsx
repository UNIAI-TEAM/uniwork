// The ways to confirm it is you inside the proof sheet (step-up-sheet.tsx, spec §4.5 and §5.2), one per kind the
// server takes: the current password (with "Quên mật khẩu?"), the authenticator's six digits sent as the sixth
// arrives or a recovery code, a six-digit code mailed for this one action (sent on request, sent again after a
// minute), and Apple's or Google's own sheet for the account linked here. Each says its refusal under its field.
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useEffect, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Platform, type TextInput, View } from "react-native";
import { AppleSignInButton } from "@/components/auth/apple-sign-in-button";
import { AuthField, FieldNote, PasswordField } from "@/components/auth/auth-field";
import { SubmitButton, TextButton } from "@/components/auth/auth-layout";
import { CodeField } from "@/components/auth/code-field";
import { ProviderButton } from "@/components/auth/provider-buttons";
import { useCountdown } from "@/components/auth/use-countdown";
import { Text } from "@/components/ui/text";
import { CODE_LENGTH } from "@/lib/sign-in-form";

/** The brands' own words on their buttons (Google's branding allows "Continue with Google"); the sheet says why. */
const CONTINUE_WITH: Record<SignInProvider, string> = {
  apple: "auth.social.continueWithApple",
  google: "auth.social.continueWithGoogle",
};

export interface ProofProps {
  busy: boolean;
  /** the refusal said under the field, or null */
  message: string | null;
  /** that refusal as a screen reader hears it while it counts down (useFailureMessage › spoken) */
  spoken: string | null;
  /** a lock counts down: nothing is taken until it lifts */
  waiting: boolean;
  /** counts the refusals: each one clears what was typed (a password or a code is never kept past one) */
  refusals: number;
  fieldRef: Ref<TextInput>;
}

/** The field's value, cleared on every refusal. */
function useClearedOnRefusal(refusals: number): [string, (next: string) => void] {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (refusals > 0) setValue("");
  }, [refusals]);
  return [value, setValue];
}

export function PasswordProof({ busy, message, spoken, waiting, refusals, fieldRef, onSubmit, onForgot }: ProofProps & {
  onSubmit: (password: string) => void;
  onForgot: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useClearedOnRefusal(refusals);
  const [required, setRequired] = useState(false);
  const submit = () => {
    if (busy || waiting) return;
    if (!password) {
      setRequired(true);
      return;
    }
    onSubmit(password);
  };
  return (
    <View className="gap-4">
      <PasswordField
        ref={fieldRef}
        label={t("settings.security.stepUp.password.label")}
        value={password}
        onChangeText={(next) => {
          setPassword(next);
          setRequired(false);
        }}
        error={message ?? (required ? t("settings.security.stepUp.password.required") : null)}
        spokenError={spoken}
        busy={busy}
        editable={!waiting}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={submit}
        testID="step-up-password"
      />
      <View className="items-start">
        <TextButton label={t("settings.security.stepUp.password.forgot")} disabled={busy} onPress={onForgot} testID="step-up-forgot" />
      </View>
      <ConfirmButton busy={busy} disabled={waiting} onPress={submit} />
    </View>
  );
}

/** The authenticator's six digits, or one of the recovery codes: the second factor is the only proof while it is on. */
export function SecondFactorProof(props: ProofProps & { onSubmit: (code: string) => void }) {
  const { busy, message, spoken, waiting, refusals, fieldRef, onSubmit } = props;
  const { t } = useTranslation();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useClearedOnRefusal(refusals);
  const [required, setRequired] = useState(false);
  const send = (value: string) => onSubmit(value);
  const submit = () => {
    if (busy || waiting) return;
    if (recovery ? !code.trim() : code.length < CODE_LENGTH) {
      setRequired(true);
      return;
    }
    send(recovery ? code.trim() : code);
  };
  const requiredLine = required ? t(recovery ? "mobile.sign_in.mfa.recovery_required" : "settings.security.stepUp.totp.required") : null;
  return (
    <View className="gap-4">
      {recovery ? (
        <AuthField
          ref={fieldRef}
          label={t("mobile.sign_in.mfa.recovery_label")}
          value={code}
          onChangeText={(next) => {
            setCode(next);
            setRequired(false);
          }}
          error={message ?? requiredLine}
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
          testID="step-up-recovery"
        />
      ) : (
        <CodeField
          ref={fieldRef}
          label={t("settings.security.stepUp.totp.label")}
          value={code}
          onChange={(next) => {
            setCode(next);
            setRequired(false);
          }}
          onComplete={(full) => {
            if (!busy && !waiting) send(full);
          }}
          error={message ?? requiredLine}
          spokenError={spoken}
          hint={t("mobile.sign_in.mfa.code_hint")}
          busy={busy}
          disabled={waiting}
          autoFocus
          testID="step-up-totp"
        />
      )}
      <ConfirmButton busy={busy} disabled={waiting} onPress={submit} />
      <View className="items-center">
        <TextButton
          label={t(recovery ? "mobile.sign_in.mfa.use_app" : "mobile.sign_in.mfa.use_recovery")}
          disabled={busy}
          onPress={() => {
            setRecovery((value) => !value);
            setCode("");
            setRequired(false);
          }}
          testID="step-up-switch-code"
        />
      </View>
    </View>
  );
}

/** The server's gap between two mailed codes (POST /me/step-up/email-code). */
const RESEND_GAP_MS = 60_000;

/**
 * A six-digit code mailed for this one action: sent on request, then typed; sent again once the minute is up. When it
 * was sent is the ask's (`sentAt`), so a sheet back from Mail, or opened again for the action, waits on the code.
 */
export function EmailCodeProof({
  busy,
  message,
  spoken,
  waiting,
  refusals,
  fieldRef,
  email,
  relay,
  sending,
  sentAt,
  onSent,
  onSend,
  onSubmit,
}: ProofProps & {
  email: string;
  relay: boolean;
  sending: boolean;
  /** when a code still good was mailed for this action, or null */
  sentAt: number | null;
  onSent: (at: number) => void;
  /** resolves true once the server said sent */
  onSend: () => Promise<boolean>;
  onSubmit: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useClearedOnRefusal(refusals);
  const left = useCountdown(sentAt === null ? null : sentAt + RESEND_GAP_MS);
  const sent = sentAt !== null;
  const asking = useRef(false);
  const send = async () => {
    if (asking.current || busy || waiting || left > 0) return;
    asking.current = true;
    try {
      if (await onSend()) {
        onSent(Date.now());
        setCode("");
      }
    } finally {
      asking.current = false;
    }
  };
  if (!sent) {
    return (
      <View className="gap-3">
        <SubmitButton
          label={relay ? t("settings.security.stepUp.emailCode.sendRelay") : t("settings.security.stepUp.emailCode.send", { email })}
          busyLabel={t("settings.security.stepUp.emailCode.sending")}
          busy={sending}
          disabled={busy || waiting}
          onPress={() => void send()}
          testID="step-up-send-code"
        />
        {relay ? (
          <Text className="text-footnote leading-[18px] text-muted-foreground">{t("settings.security.stepUp.emailCode.relayHint")}</Text>
        ) : null}
        <FieldNote error={message} spoken={spoken} />
      </View>
    );
  }
  return (
    <View className="gap-4">
      <Text accessibilityLiveRegion="polite" className="text-callout leading-5 text-foreground" testID="step-up-code-sent">
        {relay ? t("settings.security.stepUp.emailCode.sentRelay") : t("settings.security.stepUp.emailCode.sent", { email })}
      </Text>
      <CodeField
        ref={fieldRef}
        label={t("settings.security.stepUp.emailCode.label")}
        value={code}
        onChange={setCode}
        onComplete={(full) => {
          if (!busy && !waiting) onSubmit(full);
        }}
        error={message}
        spokenError={spoken}
        busy={busy}
        disabled={waiting}
        autoFocus
        testID="step-up-email-code"
      />
      <View className="items-start">
        <TextButton
          label={
            sending
              ? t("settings.security.stepUp.emailCode.sending")
              : left > 0
                ? t("settings.security.stepUp.emailCode.resendIn", { count: left })
                : t("settings.security.stepUp.emailCode.resend")
          }
          disabled={left > 0 || sending || busy}
          onPress={() => void send()}
          testID="step-up-resend"
        />
      </View>
    </View>
  );
}

/** Apple's (on the iPhone, its own system button) or Google's sheet, for the account linked here. */
export function ProviderProof({ provider, busy, message, spoken, onProve }: Pick<ProofProps, "busy" | "message" | "spoken"> & {
  provider: SignInProvider;
  onProve: () => void;
}) {
  const { t } = useTranslation();
  const name = t(`auth.social.provider.${provider}`);
  return (
    <View className="gap-3">
      {provider === "apple" && Platform.OS === "ios" ? (
        <AppleSignInButton disabled={false} busy={busy} onPress={onProve} />
      ) : (
        <ProviderButton
          provider={provider}
          label={t(CONTINUE_WITH[provider])}
          busyLabel={t("settings.security.stepUp.submitting")}
          busy={busy}
          disabled={false}
          onPress={onProve}
          testID={`step-up-${provider}`}
        />
      )}
      <Text className="text-footnote leading-[18px] text-muted-foreground">{t("settings.security.stepUp.provider.hint", { provider: name })}</Text>
      <FieldNote error={message} spoken={spoken} />
    </View>
  );
}

function ConfirmButton({ busy, disabled, onPress }: { busy: boolean; disabled: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <SubmitButton
      label={t("settings.security.stepUp.submit")}
      busyLabel={t("settings.security.stepUp.submitting")}
      busy={busy}
      disabled={disabled}
      onPress={onPress}
      testID="step-up-submit"
    />
  );
}
