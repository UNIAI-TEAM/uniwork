"use client";
import { useCallback } from "react";
import { api } from "@uniwork/core";
import { sanitizeNextUrl } from "@uniwork/core/paths";
import type { User } from "@uniwork/core/types";
import { ContinueView } from "@uniwork/views/auth/continue-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

/**
 * The choice screen a Google or Apple sign-in that found no account lands on
 * (ADR 0047 §2c, spec §4.3), and its link step (`step=link`). Once the person
 * is signed in and the screen is done, `next` is reached through the gates
 * they still owe. `replace`, not `push`: the pending sign-in is spent by then,
 * and Back should not land on a screen with nothing left to choose.
 */
export default function ContinuePage() {
  const { replace, searchParams } = useNavigation();
  const resolveDestination = useLoggedInDestination();
  const next = sanitizeNextUrl(searchParams.get("next"));
  const step = searchParams.get("step") === "link" ? "link" : null;
  const onDone = useCallback(
    async (user: User) => {
      const workspaces = await api.workspaces.list().catch(() => []);
      replace(await resolveDestination(user, workspaces, next));
    },
    [next, replace, resolveDestination],
  );
  return <ContinueView next={next} step={step} onDone={(user) => void onDone(user)} />;
}
