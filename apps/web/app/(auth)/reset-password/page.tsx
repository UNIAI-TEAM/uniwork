"use client";
import { useEffect } from "react";
import { api } from "@uniwork/core";
import { paths } from "@uniwork/core/paths";
import { ResetPasswordView } from "@uniwork/views/auth/reset-password-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

export default function ResetPasswordPage() {
  const { push, replace, searchParams } = useNavigation();
  const resolveDestination = useLoggedInDestination();
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) replace(paths.forgotPassword());
  }, [token, replace]);

  if (!token) return null;
  return (
    <ResetPasswordView
      token={token}
      onSuccess={async (sess) => {
        push(await resolveDestination(sess.user, await api.workspaces.list().catch(() => [])));
      }}
    />
  );
}
