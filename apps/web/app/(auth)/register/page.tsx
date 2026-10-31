"use client";
import { sanitizeNextUrl } from "@uniwork/core/paths";
import { RegisterView } from "@uniwork/views/auth/register-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

export default function RegisterPage() {
  const { push, searchParams } = useNavigation();
  const resolveDestination = useLoggedInDestination();
  // An invitation or the desktop app's consent sent the person here through
  // login: the new account goes on to it once verified (spec §4.2).
  const next = sanitizeNextUrl(searchParams.get("next"));
  return (
    <RegisterView
      next={next}
      onSuccess={async (sess) => {
        push(await resolveDestination(sess.user, [], next));
      }}
    />
  );
}
