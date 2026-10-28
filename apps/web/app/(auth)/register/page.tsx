"use client";
import { resolvePostAuthNavigation, sanitizeNextUrl } from "@uniwork/core/paths";
import { RegisterView } from "@uniwork/views/auth/register-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

export default function RegisterPage() {
  const { push, searchParams } = useNavigation();
  const resolveDestination = useLoggedInDestination();
  const next = sanitizeNextUrl(searchParams.get("next"));
  return (
    <RegisterView
      next={next}
      onSuccess={async (sess) => {
        push(resolvePostAuthNavigation(await resolveDestination(sess.user, []), next));
      }}
    />
  );
}
