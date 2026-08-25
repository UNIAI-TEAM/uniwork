"use client";
import { useRouter } from "next/navigation";
import { RegisterView } from "@uniwork/views/auth/register-view";
import { resolveLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";

export default function RegisterPage() {
  const router = useRouter();
  return (
    <RegisterView
      onSuccess={async (sess) => {
        router.push(await resolveLoggedInDestination(sess.user.onboarded_at != null, []));
      }}
    />
  );
}
