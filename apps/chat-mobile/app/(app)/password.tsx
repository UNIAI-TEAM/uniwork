// Settings › Sign-in methods › Đặt mật khẩu / Đổi mật khẩu (spec §5.2): the account's own screen, outside every
// workspace, reached from either Settings.
import { router } from "expo-router";
import { AuthLayout } from "@/components/auth/auth-layout";
import { PasswordForm } from "@/components/settings/password-form";

export default function Password() {
  return (
    <AuthLayout testID="password-screen" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
      <PasswordForm />
    </AuthLayout>
  );
}
