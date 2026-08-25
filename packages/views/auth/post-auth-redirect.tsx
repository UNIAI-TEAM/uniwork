import { paths, resolvePostAuthDestination } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { fetchMyInvitations } from "@uniwork/core/workspaces";

/** Chưa onboard + có lời mời chờ → /invitations; còn lại theo resolver onboarded-first. */
export async function resolveLoggedInDestination(hasOnboarded: boolean, workspaces: Workspace[]): Promise<string> {
  if (!hasOnboarded) {
    try {
      const invites = await fetchMyInvitations();
      if (invites.length > 0) return paths.invitations();
    } catch {
      /* không chặn đăng nhập vì lỗi phụ */
    }
  }
  return resolvePostAuthDestination(workspaces, hasOnboarded);
}
