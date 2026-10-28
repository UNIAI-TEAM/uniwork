// An invitation's link (/invite/{token}, lib/deep-link.ts): its preview, kept through sign-in, which joins nothing by
// itself (spec §5.2).
import { router, useLocalSearchParams } from "expo-router";
import { AuthLayout } from "@/components/auth/auth-layout";
import { InvitationPreview } from "@/components/workspace/invitation-preview";

export default function Invitation() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return (
    <AuthLayout testID="invitation-screen" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
      <InvitationPreview token={typeof token === "string" ? token : ""} />
    </AuthLayout>
  );
}
