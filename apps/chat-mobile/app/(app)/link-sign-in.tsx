// "Tôi đã có tài khoản", once signed in (spec §4.3 step=link): link the identity the choice screen holds into this
// account, or not, then into the app.
import { AuthLayout } from "@/components/auth/auth-layout";
import { LinkStep } from "@/components/auth/link-step";

export default function LinkSignIn() {
  return (
    <AuthLayout testID="link-sign-in-screen">
      <LinkStep />
    </AuthLayout>
  );
}
