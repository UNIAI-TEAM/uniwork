"use client";
import { useEffect } from "react";
import { api } from "@uniwork/core";
import { useSession } from "@uniwork/core/auth";
import { paths, pendingAuthStep } from "@uniwork/core/paths";
import { VerifyEmailView } from "@uniwork/views/auth/verify-email-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

export default function VerifyPage() {
  const { push, replace } = useNavigation();
  const { status, user } = useSession();
  const resolveDestination = useLoggedInDestination();
  const step = pendingAuthStep(user);

  useEffect(() => {
    if (status === "anon") replace(paths.login());
    // Already verified (or arrived here by hand): move on to whatever is next.
    if (status === "authed" && user && step !== "verify") {
      void (async () => replace(await resolveDestination(user, await api.workspaces.list().catch(() => []))))();
    }
  }, [status, user, step, replace, resolveDestination]);

  if (status !== "authed" || step !== "verify") return null;
  return (
    <VerifyEmailView
      onSuccess={async (verified) => {
        const workspaces = await api.workspaces.list().catch(() => []);
        push(await resolveDestination(verified, workspaces));
      }}
    />
  );
}
