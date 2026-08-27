"use client";
import { RegisterView } from "@uniwork/views/auth/register-view";
import { resolveLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

export default function RegisterPage() {
  const { push } = useNavigation();
  return (
    <RegisterView
      onSuccess={async (sess) => {
        push(await resolveLoggedInDestination(sess.user, []));
      }}
    />
  );
}
