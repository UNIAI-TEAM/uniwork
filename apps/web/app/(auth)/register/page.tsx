"use client";
import { RegisterView } from "@uniwork/views/auth/register-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

export default function RegisterPage() {
  const { push } = useNavigation();
  const resolveDestination = useLoggedInDestination();
  return (
    <RegisterView
      onSuccess={async (sess) => {
        push(await resolveDestination(sess.user, []));
      }}
    />
  );
}
