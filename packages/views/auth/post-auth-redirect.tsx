import { paths, pendingAuthStep, resolvePostAuthDestination, type AuthGateUser } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { fetchMyInvitations } from "@uniwork/core/workspaces";

/**
 * Chưa verify → /verify; chưa onboard + có lời mời chờ → /invitations; còn lại
 * theo resolver verify → onboarding → workspace.
 */
export async function resolveLoggedInDestination(user: AuthGateUser, workspaces: Workspace[]): Promise<string> {
  const step = pendingAuthStep(user);
  if (step === "verify") return paths.verify();
  if (step === "onboarding") {
    try {
      const invites = await fetchMyInvitations();
      if (invites.length > 0) return paths.invitations();
    } catch {
      /* không chặn đăng nhập vì lỗi phụ */
    }
  }
  return resolvePostAuthDestination(workspaces, user);
}
