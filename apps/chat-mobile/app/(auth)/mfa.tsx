// The second factor of a sign-in (spec §5.2): the code of the challenge the sign-in screen holds in memory. Signed
// in, the entry takes over, or the link step when this sign-in was to link a provider (link=1).
import { Redirect, useLocalSearchParams } from "expo-router";
import { AuthLayout } from "@/components/auth/auth-layout";
import { SecondFactorStep, leaveSecondFactor } from "@/components/auth/second-factor-step";
import { usePendingSignIn } from "@/data/auth/pending-sign-in";
import { useAuthStore } from "@/data/auth/store";
import { afterSignInHref, isLinkMode } from "@/lib/sign-in-routes";

export default function SecondFactor() {
  const params = useLocalSearchParams<{ link?: string }>();
  const linkMode = isLinkMode(params.link);
  const user = useAuthStore((s) => s.user);
  const choiceHeld = usePendingSignIn((s) => s.choice !== null);
  if (user) return <Redirect href={afterSignInHref({ linkMode, choiceHeld })} />;
  return (
    <AuthLayout testID="mfa-screen" onBack={leaveSecondFactor}>
      <SecondFactorStep linkMode={linkMode} />
    </AuthLayout>
  );
}
