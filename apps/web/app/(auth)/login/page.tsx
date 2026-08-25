"use client";
import { api } from "@uniwork/core";
import { sanitizeNextUrl } from "@uniwork/core/paths";
import { LoginView } from "@uniwork/views/auth/login-view";
import { resolveLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

export default function LoginPage() {
  const { push, searchParams } = useNavigation();
  const next = sanitizeNextUrl(searchParams.get("next"));
  return (
    <LoginView
      onSuccess={async (sess) => {
        if (next) {
          push(next);
          return;
        }
        const workspaces = await api.workspaces.list();
        push(await resolveLoggedInDestination(sess.user.onboarded_at != null, workspaces));
      }}
    />
  );
}
