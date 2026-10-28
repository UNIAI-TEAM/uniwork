// A new account (spec §5.2): Apple and Google with intent=sign_up (an account at once, never the choice screen),
// or a name, an address and a password. Signed in, the entry sends a new address to be proved first.
import { Redirect, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { AuthHeading, AuthLayout, TextButton } from "@/components/auth/auth-layout";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { RegisterForm } from "@/components/auth/register-form";
import { useFailureMessage, useSignIn } from "@/components/auth/use-sign-in";
import { SignInLegalNote } from "@/components/settings/sign-in-legal-note";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { signInRoutes } from "@/lib/sign-in-routes";

export default function Register() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const signIn = useSignIn("register");
  const { message, spoken, waiting } = useFailureMessage(signIn.shown);
  if (user) return <Redirect href="/" />;
  const toLogin = () => (router.canGoBack() ? router.back() : router.replace(signInRoutes.login()));
  return (
    <AuthLayout testID="register-screen" onBack={toLogin}>
      <AuthHeading mark title={t("mobile.sign_in.register.title")} subtitle={t("mobile.sign_in.register.subtitle")} />
      <ProviderButtons intent="sign_up" busy={signIn.busy} onStart={(request, provider) => void signIn.run(request, provider)} />
      <RegisterForm
        busy={signIn.busy}
        message={message}
        spoken={spoken}
        waiting={waiting}
        onSubmit={(input) => signIn.run({ method: "register", ...input }, "register")}
      />
      <View className="flex-1" />
      <View className="items-center gap-1">
        <View className="flex-row flex-wrap items-center justify-center gap-x-1">
          <Text className="text-subhead text-muted-foreground">{t("auth.hasAccount")}</Text>
          <TextButton label={t("auth.login")} disabled={signIn.busy !== null} onPress={toLogin} testID="register-login" />
        </View>
        <SignInLegalNote />
      </View>
    </AuthLayout>
  );
}
