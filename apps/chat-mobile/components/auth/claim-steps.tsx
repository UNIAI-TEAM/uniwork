// "Tôi được mời bằng email khác" on the choice screen (spec §3.2, §4.3): the work address the organization invited,
// then the six-digit code mailed there, which signs in to that address's account (linking the Google or Apple
// identity), takes back an account that never proved it, or opens one. The code can be asked again after a minute;
// a code asked too often waits for the server's retry_after. The ticket and its nonce never leave memory.
import { CODE_LENGTH, emailError } from "@uniwork/core/auth/sign-in-form";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View } from "react-native";
import { useAnnounce } from "@/components/ui/a11y";
import { Text } from "@/components/ui/text";
import { useSendClaimCode } from "@/data/mutations/sign-in";
import { signInFailureOf } from "@/lib/sign-in-failure";
import { AuthField } from "./auth-field";
import { AuthHeading, SubmitButton, TextButton } from "./auth-layout";
import { CodeField } from "./code-field";
import { useCountdown } from "./use-countdown";
import { shownFailure, useFailureMessage, useSignIn, type ShownFailure } from "./use-sign-in";

/** The server's gap between two codes to one address (spec §4.3: the resend counts down 60 s). */
export const RESEND_GAP_MS = 60_000;

/**
 * Mails a code for the held ticket. A refusal comes back as what the step shows; a ticket that is gone (`restart`)
 * is for the screen to say.
 */
function useClaimCode() {
  const send = useSendClaimCode();
  const [shown, setShown] = useState<ShownFailure | null>(null);
  const mail = async (email: string): Promise<"sent" | "refused" | "restart"> => {
    setShown(null);
    try {
      await send.mutateAsync(email);
      return "sent";
    } catch (error: unknown) {
      const failure = signInFailureOf(error, "claim");
      setShown(shownFailure(failure));
      return failure.kind === "restart" ? "restart" : "refused";
    }
  };
  return { mail, sending: send.isPending, shown, clear: () => setShown(null) };
}

interface EmailStepProps {
  email: string;
  onChangeEmail: (email: string) => void;
  onSent: () => void;
  onRestart: () => void;
}

export function ClaimEmailStep({ email, onChangeEmail, onSent, onRestart }: EmailStepProps) {
  const { t } = useTranslation();
  const claim = useClaimCode();
  const { message, spoken, waiting } = useFailureMessage(claim.shown);
  const [invalid, setInvalid] = useState<string | null>(null);
  const input = useRef<TextInput>(null);

  const send = async () => {
    if (claim.sending || waiting) return;
    const error = emailError(email);
    setInvalid(error ? t(error.key) : null);
    if (error) {
      input.current?.focus();
      return;
    }
    const sent = await claim.mail(email);
    if (sent === "sent") onSent();
    else if (sent === "restart") onRestart();
    else input.current?.focus();
  };

  return (
    <View className="gap-6" testID="claim-email-step">
      <AuthHeading title={t("auth.continue.claim.emailTitle")} subtitle={t("auth.continue.claim.emailBody")} />
      <AuthField
        ref={input}
        label={t("auth.continue.claim.emailLabel")}
        value={email}
        onChangeText={(next) => {
          onChangeEmail(next);
          setInvalid(null);
          claim.clear();
        }}
        error={invalid ?? message}
        spokenError={invalid ? null : spoken}
        placeholder={t("auth.continue.claim.emailPlaceholder")}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        autoCapitalize="none"
        autoFocus
        returnKeyType="send"
        onSubmitEditing={() => void send()}
        busy={claim.sending}
        testID="claim-email"
      />
      <SubmitButton
        label={t("auth.continue.claim.send")}
        busyLabel={t("auth.continue.claim.sending")}
        busy={claim.sending}
        disabled={waiting}
        onPress={() => void send()}
        testID="claim-send"
      />
    </View>
  );
}

interface CodeStepProps {
  email: string;
  /** when the code may be asked again */
  resendAtMs: number;
  onResent: () => void;
  onChangeEmail: () => void;
  onRestart: () => void;
}

export function ClaimCodeStep({ email, resendAtMs, onResent, onChangeEmail, onRestart }: CodeStepProps) {
  const { t } = useTranslation();
  const signIn = useSignIn("claim");
  const claim = useClaimCode();
  const verifying = useFailureMessage(signIn.shown);
  const resending = useFailureMessage(claim.shown);
  const left = useCountdown(resendAtMs);
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const input = useRef<TextInput>(null);
  const busy = signIn.busy !== null;
  const resentLine = resent ? t("auth.continue.claim.resent", { email }) : null;
  useAnnounce(resentLine);

  const verify = async (value: string) => {
    if (busy) return;
    setResent(false);
    const result = await signIn.run({ method: "email_claim", email, code: value }, "claim-code");
    if (!result || result.ok) return;
    setCode("");
    if (result.failure.kind === "restart") onRestart();
    else input.current?.focus();
  };

  const resend = async () => {
    setResent(false);
    signIn.clearFailure();
    const sent = await claim.mail(email);
    if (sent === "sent") {
      setResent(true);
      onResent();
    } else if (sent === "restart") onRestart();
  };

  return (
    <View className="gap-6" testID="claim-code-step">
      <AuthHeading title={t("auth.continue.claim.codeTitle")} subtitle={t("auth.continue.claim.codeBody", { email })} />
      <CodeField
        ref={input}
        label={t("auth.continue.claim.codeLabel")}
        value={code}
        onChange={setCode}
        onComplete={(full) => void verify(full)}
        error={verifying.message ?? resending.message}
        spokenError={verifying.message ? verifying.spoken : resending.spoken}
        busy={busy}
        disabled={verifying.waiting}
        autoFocus
        testID="claim-code"
      />
      {resentLine ? (
        <Text accessibilityLiveRegion="polite" className="text-callout text-foreground" testID="claim-resent">
          {resentLine}
        </Text>
      ) : null}
      <SubmitButton
        label={t("auth.continue.claim.verify")}
        busyLabel={t("auth.continue.claim.verifying")}
        busy={busy}
        disabled={verifying.waiting}
        onPress={() => (code.length === CODE_LENGTH ? void verify(code) : input.current?.focus())}
        testID="claim-verify"
      />
      <View className="items-center gap-1">
        <TextButton
          label={left > 0 ? t("auth.continue.claim.resendIn", { count: left }) : t("auth.continue.claim.resend")}
          disabled={left > 0 || claim.sending || busy || resending.waiting}
          onPress={() => void resend()}
          testID="claim-resend"
        />
        <TextButton label={t("auth.continue.claim.changeEmail")} tone="muted" disabled={busy} onPress={onChangeEmail} testID="claim-change-email" />
        <Text className="text-center text-footnote text-muted-foreground">{t("auth.continue.claim.spamHint")}</Text>
      </View>
    </View>
  );
}
