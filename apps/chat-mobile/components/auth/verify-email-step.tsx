// Proving a new account's address (spec §5.2), as the web's /verify does: the six digits mailed at sign-up, checked
// as soon as the sixth arrives; a code mailed again after a minute (the server's gap, counted from arrival because
// sign-up just sent one); a way out for a wrong address (sign out) and to Settings, where the account can be deleted.
// Until the address is proved the app shows no workspace (app/index.tsx, select-workspace.tsx).
import { router } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, TextInput, View } from "react-native";
import { useAnnounce } from "@/components/ui/a11y";
import { haptics } from "@/components/ui/haptics";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { useAuthStore } from "@/data/auth/store";
import { useResendVerification, useVerifyEmail } from "@/data/mutations/account";
import { accountRoutes } from "@/lib/chat-routes";
import { verifyEmailFailureOf } from "@/lib/sign-in-failure";
import { THEME } from "@/lib/theme";
import { AuthHeading, TextButton } from "./auth-layout";
import { CodeField } from "./code-field";
import { useCountdown } from "./use-countdown";
import { shownFailure, useFailureMessage, type ShownFailure } from "./use-sign-in";

/** The server's gap between two codes (POST /me/email/resend). */
const RESEND_GAP_MS = 60_000;

export function VerifyEmailStep() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const email = useAuthStore((s) => s.user?.email ?? "");
  const logout = useAuthStore((s) => s.logout);
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const [code, setCode] = useState("");
  const [shown, setShown] = useState<ShownFailure | null>(null);
  const [resendAtMs, setResendAtMs] = useState(() => Date.now() + RESEND_GAP_MS);
  const [resent, setResent] = useState(false);
  const left = useCountdown(resendAtMs);
  const { message, spoken } = useFailureMessage(shown);
  const input = useRef<TextInput>(null);
  const resentLine = resent ? t("auth.verify.resent") : null;
  useAnnounce(resentLine);

  const check = async (value: string) => {
    if (verify.isPending) return;
    setShown(null);
    setResent(false);
    try {
      // Verified, the signed-in user carries the date and the route moves on.
      await verify.mutateAsync(value);
    } catch (error: unknown) {
      setShown(shownFailure(verifyEmailFailureOf(error)));
      haptics.failure();
      setCode("");
      input.current?.focus();
    }
  };

  const mailAgain = async () => {
    if (left > 0 || resend.isPending) return;
    setShown(null);
    setResent(false);
    try {
      await resend.mutateAsync(undefined);
      setResent(true);
      setResendAtMs(Date.now() + RESEND_GAP_MS);
    } catch (error: unknown) {
      const failure = verifyEmailFailureOf(error);
      setShown(shownFailure(failure));
      if (failure.code === "rate_limited") setResendAtMs(Date.now() + RESEND_GAP_MS);
    }
  };

  return (
    <View className="flex-1 gap-6" testID="verify-email-step">
      <AuthHeading title={t("auth.verify.title")} subtitle={t("auth.verify.subtitle", { email })} />
      <CodeField
        ref={input}
        label={t("auth.verify.codeLabel")}
        value={code}
        onChange={setCode}
        onComplete={(full) => void check(full)}
        error={message}
        spokenError={spoken}
        busy={verify.isPending}
        autoFocus
        testID="verify-code"
      />
      {verify.isPending ? (
        <View accessibilityLiveRegion="polite" className="flex-row items-center gap-2">
          <ActivityIndicator accessibilityLabel={t("auth.verify.verifying")} color={THEME[colorScheme].mutedForeground} />
          <Text className="text-callout text-muted-foreground">{t("auth.verify.verifying")}</Text>
        </View>
      ) : resentLine ? (
        <Text accessibilityLiveRegion="polite" className="text-callout text-foreground" testID="verify-resent">
          {resentLine}
        </Text>
      ) : null}
      <View className="items-start gap-1">
        <TextButton
          label={resend.isPending ? t("auth.verify.resending") : left > 0 ? t("auth.verify.resendIn", { seconds: left }) : t("auth.verify.resend")}
          disabled={left > 0 || resend.isPending || verify.isPending}
          onPress={() => void mailAgain()}
          testID="verify-resend"
        />
        <Text className="text-footnote text-muted-foreground">{t("auth.verify.spamHint")}</Text>
      </View>
      <View className="flex-1" />
      <View className="items-center gap-1 border-t border-border pt-4">
        <View className="flex-row flex-wrap items-center justify-center gap-x-1">
          <Text className="text-subhead text-muted-foreground">{t("mobile.sign_in.verify.wrong_email")}</Text>
          <TextButton label={t("auth.logout")} disabled={verify.isPending} onPress={() => void logout()} testID="verify-logout" />
        </View>
        <TextButton
          label={t("mobile.sign_in.verify.delete_in_settings")}
          tone="muted"
          onPress={() => router.push(accountRoutes.settings)}
          testID="verify-settings"
        />
      </View>
    </View>
  );
}
