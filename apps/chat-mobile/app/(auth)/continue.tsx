// The choice screen (spec §5.2): what to do with a Google or Apple identity no account matched. Signed in from
// here (a new account, the invited address), the entry takes over. Signed in through "Tôi đã có tài khoản" while this
// screen is shown again (the person went back while that sign-in ran), the identity still held goes to its link step.
import { Redirect } from "expo-router";
import { ContinueFlow } from "@/components/auth/continue-flow";
import { usePendingSignIn } from "@/data/auth/pending-sign-in";
import { useAuthStore } from "@/data/auth/store";
import { afterSignInHref } from "@/lib/sign-in-routes";

export default function Continue() {
  const user = useAuthStore((s) => s.user);
  // A session from this screen's own ways spent the choice; only a sign-in that did not still holds it.
  const choiceHeld = usePendingSignIn((s) => s.choice !== null);
  if (user) return <Redirect href={afterSignInHref({ linkMode: true, choiceHeld })} />;
  return <ContinueFlow />;
}
