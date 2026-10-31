// What the sign-in screen says above its buttons when it is not a plain sign-in (spec §4.4, §5.2): signing in to link
// a Google or Apple identity the choice screen holds ("Tôi đã có tài khoản"), with "Không liên kết" to drop it; or a
// choice screen the last run of the app was closed on, with "Thử lại" for that provider.
import type { SignInIdentity, SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useTranslation } from "react-i18next";
import { NoticeCard, TextButton } from "./auth-layout";

export function LinkModeNotice({ identity, disabled, onDecline }: { identity: SignInIdentity; disabled: boolean; onDecline: () => void }) {
  const { t } = useTranslation();
  const provider = t(`auth.social.provider.${identity.provider}`);
  const message = identity.private_relay
    ? t("auth.continue.loginMode.bannerRelay", { provider })
    : t("auth.continue.loginMode.banner", { provider, email: identity.email });
  return (
    <NoticeCard
      message={message}
      testID="login-link-mode"
      action={<TextButton label={t("auth.continue.loginMode.decline")} disabled={disabled} onPress={onDecline} testID="login-link-decline" />}
    />
  );
}

export function InterruptedNotice({ provider, disabled, onRetry }: { provider: SignInProvider; disabled: boolean; onRetry: (() => void) | null }) {
  const { t } = useTranslation();
  const retry = onRetry ? (
    <TextButton label={t("auth.continue.expired.retry")} disabled={disabled} onPress={onRetry} testID="login-interrupted-retry" />
  ) : null;
  return (
    <NoticeCard
      message={t("auth.continue.expired.bodyProvider", { provider: t(`auth.social.provider.${provider}`) })}
      testID="login-interrupted"
      action={retry}
    />
  );
}
