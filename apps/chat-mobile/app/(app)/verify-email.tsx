// A signed-in account that has not proved its address yet (spec §5.2): the code mailed at sign-up, before any
// workspace. Proved, the entry takes over.
import { Redirect } from "expo-router";
import { AuthLayout } from "@/components/auth/auth-layout";
import { VerifyEmailStep } from "@/components/auth/verify-email-step";
import { useAuthStore } from "@/data/auth/store";

export default function VerifyEmail() {
  const verified = useAuthStore((s) => s.user?.email_verified_at !== null);
  if (verified) return <Redirect href="/" />;
  return (
    <AuthLayout testID="verify-email-screen">
      <VerifyEmailStep />
    </AuthLayout>
  );
}
