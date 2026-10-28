// The choice screen (spec §5.2): what to do with a Google or Apple identity no account matched. Signed in from
// here (a new account, the invited address), the entry takes over.
import { Redirect } from "expo-router";
import { ContinueFlow } from "@/components/auth/continue-flow";
import { useAuthStore } from "@/data/auth/store";

export default function Continue() {
  const user = useAuthStore((s) => s.user);
  if (user) return <Redirect href="/" />;
  return <ContinueFlow />;
}
