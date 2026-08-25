"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@uniwork/core";
import { sanitizeNextUrl } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { LoginView } from "@uniwork/views/auth/login-view";
import { resolveLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";

export default function LoginPage() {
  const router = useRouter();
  const next = sanitizeNextUrl(useSearchParams().get("next"));
  return (
    <LoginView
      onSuccess={async (sess) => {
        if (next) {
          router.push(next);
          return;
        }
        const { workspaces } = await api.request<{ workspaces: Workspace[] }>("/api/v1/workspaces");
        router.push(await resolveLoggedInDestination(sess.user.onboarded_at != null, workspaces));
      }}
    />
  );
}
