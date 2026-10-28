"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@uniwork/core";
import { useSession } from "@uniwork/core/auth";
import { sanitizeNextUrl, type AuthGateUser } from "@uniwork/core/paths";
import { LoginView } from "@uniwork/views/auth/login-view";
import { isLinkStep, useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";
import { ProviderHandoff, providerHint, useDropProviderHint } from "../../../platform/auth/provider-handoff";
import { useIsUniChatHost } from "../../../platform/desktop-host";
import { UniChatLoginGate } from "../../../platform/unichat-login-gate";

export default function LoginPage() {
  const isUniChat = useIsUniChatHost();
  const { push, searchParams } = useNavigation();
  const resolveDestination = useLoggedInDestination();
  const next = sanitizeNextUrl(searchParams.get("next"));
  const rawReason = searchParams.get("reason");
  const reason = rawReason === "meeting_invite" || rawReason === "session_expired" ? rawReason : null;
  const initialMfa = searchParams.get("mfa") === "1";
  // The choice screen's "Tôi đã có tài khoản UniWork" (spec §4.4). A link
  // step as `next` is link mode too, the server's own rule
  // (keepsSignInTicket): a provider sign-in that met a second factor comes
  // back as /login?mfa=1&next=<link step>, without link=1, and the code must
  // still keep the waiting sign-in.
  const link = searchParams.get("link") === "1" || isLinkStep(next);
  // The app's provider button (spec §3.5), read once: the hint leaves the
  // address bar at once, and that must not take the hand-off back with it.
  const [hint] = useState(() => providerHint(searchParams));
  useDropProviderHint(searchParams.has("provider"));
  const { status, user } = useSession();
  const goAfterLogin = useCallback(
    async (u: AuthGateUser, to: string | null = next) => {
      const workspaces = await api.workspaces.list().catch(() => []);
      // `next` rides through the gate steps the user still owes.
      push(await resolveDestination(u, workspaces, to));
    },
    [next, push, resolveDestination],
  );
  useEffect(() => {
    // The shell's login lands as a token the auth store resolves, not through this form's onSuccess.
    if (isUniChat && status === "authed" && user) void goAfterLogin(user);
  }, [isUniChat, status, user, goAfterLogin]);
  // The shell's cookie-less session only starts through the system browser (PKCE), never this form.
  // Blank until the session resolves, so a signed-in launch goes to the chat without flashing the gate.
  // It never follows a provider hint: that is the system browser's job.
  if (isUniChat) return status === "anon" ? <UniChatLoginGate /> : null;
  const form = (
    <LoginView
      next={next}
      redirectError={searchParams.get("error")}
      reason={reason}
      initialMfa={initialMfa}
      link={link}
      fromReset={searchParams.get("reset") === "1"}
      onSuccess={(sess, to) => goAfterLogin(sess.user, to)}
    />
  );
  return hint ? (
    <ProviderHandoff provider={hint} next={next}>
      {form}
    </ProviderHandoff>
  ) : (
    form
  );
}
