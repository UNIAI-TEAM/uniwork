// The app's own sign-in screen (ADR 0049, spec §5.2): the mark and the title, Apple and Google, then email and
// password, then the way to a new account and the browser for anyone the native doors cannot serve. A second factor
// or a choice moves on to its screen (components/auth/use-sign-in.ts); signed in, the entry takes over. With link=1
// and an identity held by the choice screen it is "Tôi đã có tài khoản": a notice says what will be linked, that
// provider's own button is gone, and the sign-in ends on the link step.
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { AuthHeading, AuthLayout, TextButton } from "@/components/auth/auth-layout";
import { LoginForm } from "@/components/auth/login-form";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { InterruptedNotice, LinkModeNotice } from "@/components/auth/sign-in-notices";
import { useFailureMessage, useSignIn } from "@/components/auth/use-sign-in";
import { SignInLegalNote } from "@/components/settings/sign-in-legal-note";
import { Text } from "@/components/ui/text";
import { clearChoice, dismissInterrupted, usePendingSignIn } from "@/data/auth/pending-sign-in";
import { useAuthStore } from "@/data/auth/store";
import { signInOfferOptions } from "@/data/queries/sign-in";
import { providerRequest } from "@/lib/sign-in-offer";
import { afterSignInHref, isLinkMode, signInRoutes } from "@/lib/sign-in-routes";

export default function Login() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ link?: string }>();
  const user = useAuthStore((s) => s.user);
  const choice = usePendingSignIn((s) => s.choice);
  const interrupted = usePendingSignIn((s) => s.interrupted);
  const offer = useQuery(signInOfferOptions()).data;
  // Link mode, while the choice screen still holds the identity to link.
  const linking = isLinkMode(params.link) ? choice : null;
  const linkMode = linking !== null;
  const signIn = useSignIn("sign_in", { linkMode });
  const { message, spoken, waiting } = useFailureMessage(signIn.shown);
  const idle = signIn.busy === null;

  if (user) return <Redirect href={afterSignInHref({ linkMode, choiceHeld: choice !== null })} />;

  const interruptedRetry = interrupted ? providerRequest(interrupted, offer) : null;

  return (
    <AuthLayout testID="login-screen" onBack={linkMode ? () => router.back() : undefined}>
      <AuthHeading mark title={t("mobile.sign_in.title")} subtitle={t("mobile.sign_in.subtitle")} />
      {linking ? (
        <LinkModeNotice
          identity={linking.identity}
          disabled={!idle}
          onDecline={() => {
            clearChoice();
            if (router.canGoBack()) router.dismissAll();
          }}
        />
      ) : interrupted ? (
        <InterruptedNotice
          provider={interrupted}
          disabled={!idle}
          onRetry={interruptedRetry ? () => void signIn.run(interruptedRetry, interrupted) : null}
        />
      ) : null}
      <ProviderButtons
        busy={signIn.busy}
        hidden={linking?.identity.provider ?? null}
        onStart={(request, provider) => void signIn.run(request, provider)}
      />
      <LoginForm
        busy={signIn.busy}
        message={message}
        spoken={spoken}
        waiting={waiting}
        onSubmit={(email, password) => signIn.run({ method: "password", email, password }, "password")}
      />
      <View className="flex-1" />
      <View className="items-center gap-1">
        {linkMode ? null : (
          <>
            <View className="flex-row flex-wrap items-center justify-center gap-x-1">
              <Text className="text-subhead text-muted-foreground">{t("auth.noAccount")}</Text>
              <TextButton
                label={t("mobile.sign_in.create_account")}
                disabled={!idle}
                onPress={() => {
                  dismissInterrupted();
                  router.push(signInRoutes.register);
                }}
                testID="login-register"
              />
            </View>
            <TextButton
              label={t(signIn.busy === "browser" ? "mobile.sign_in.browser_busy" : "mobile.sign_in.browser")}
              tone="muted"
              disabled={!idle}
              onPress={() => void signIn.run({ method: "browser" })}
              testID="login-browser"
            />
          </>
        )}
        <SignInLegalNote />
      </View>
    </AuthLayout>
  );
}
