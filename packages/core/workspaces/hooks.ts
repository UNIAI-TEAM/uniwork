"use client";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../auth/store";
import * as auth from "../api/endpoints/auth";
import { setSessionUser } from "../auth/hooks";
import * as workspaces from "../api/endpoints/workspaces";
import { useOrganizations } from "../organizations/hooks";
import { resolveHomeDestination } from "../paths/resolve";
import type { SwitchResolution } from "../types/workspace";
import { workspaceKeys } from "./keys";
import { readLastWorkspace } from "./last-workspace";

export type { InviteResult } from "../api/endpoints/workspaces";
export { workspaceKeys } from "./keys";
export { rememberLastWorkspace } from "./last-workspace";

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `enabled: false` mounts the hook without reading (a screen still resolving its gates). */
export function useWorkspaces(enabled = true) {
  const authed = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => workspaces.list(),
    enabled: authed && enabled,
  });
}

/**
 * The "Home" link for a signed-in user; null until the session and both lists
 * are known. The organization list decides between a workspace and
 * /get-started (ADR 0032 D12), and filters out workspaces of an organization
 * the user no longer belongs to.
 */
export function useHomeDestination(): string | null {
  const user = useAuthStore((s) => s.user);
  const authed = useAuthStore((s) => s.status === "authed");
  const { data: list } = useWorkspaces();
  const { data: orgs } = useOrganizations(authed);
  if (!user || !list || !orgs) return null;
  return resolveHomeDestination(list, user, readLastWorkspace(user.id), orgs);
}

export function useWorkspace(orgSlug: string, wsSlug: string) {
  return useQuery({
    queryKey: workspaceKeys.bySlugs(orgSlug, wsSlug),
    queryFn: () => workspaces.getBySlugs(orgSlug, wsSlug),
    enabled: !!orgSlug && !!wsSlug,
    retry: false,
  });
}

export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => workspaces.listMembers(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useMyMembership(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.me(workspaceId),
    queryFn: () => workspaces.getMyMembership(workspaceId),
    enabled: !!workspaceId,
    retry: false,
  });
}

export function useInvite(workspaceId: string) {
  return useMutation({
    mutationFn: (body: { emails: string[]; role: "admin" | "member" }) =>
      workspaces.invite(workspaceId, body),
  });
}

export function useUpdateMemberRole(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "member" }) =>
      workspaces.updateMemberRole(workspaceId, userId, { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.me(workspaceId) });
    },
  });
}

export function useRemoveMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => workspaces.removeMember(workspaceId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.me(workspaceId) });
      // Leaving one's own workspace lands on the picker, which must not offer it.
      void qc.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}

export function useMyInvitations(enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.myInvitations(),
    queryFn: () => workspaces.myInvitations(),
    enabled,
  });
}

export function fetchMyInvitations() {
  return workspaces.myInvitations();
}

/**
 * The invitation behind a link and what stands between the caller and it.
 * Not retried: a 404 or a wrong-mailbox 403 is the answer, not a blip.
 */
export function useInvitationPreview(token: string, enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.invitationPreview(token),
    queryFn: () => workspaces.getInvitationPreview(token),
    enabled: enabled && !!token,
    retry: false,
  });
}

/**
 * Accepting may switch organization (ADR 0032): `resolve` says how to give up
 * each one the caller belongs to. Every cached list may now name the wrong
 * organization, so the cache is dropped, and the session user is read again —
 * accepting also marks them onboarded, and the dashboard gate routes on that —
 * before anything navigates (AC-15).
 */
export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ token, resolve }: { token: string; resolve?: SwitchResolution[] }) =>
      workspaces.acceptInvite(token, resolve),
    onSuccess: async () => {
      qc.clear();
      // The join already committed: a failed read of /me must not turn it
      // into an error the page would show. The gate refetches it anyway.
      const user = await auth.me().catch(() => null);
      if (user) setSessionUser(user);
    },
  });
}

function refreshWorkspace(qc: QueryClient, orgSlug: string, wsSlug: string) {
  void qc.invalidateQueries({ queryKey: workspaceKeys.list() });
  void qc.invalidateQueries({ queryKey: workspaceKeys.bySlugs(orgSlug, wsSlug) });
}

export function usePatchWorkspace(orgSlug: string, wsSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wsId, ...body }: { wsId: string } & workspaces.WorkspacePatch) =>
      workspaces.patchWorkspace(wsId, body),
    onSuccess: (updated, { slug }) => {
      // The page redirects to the new slug next; seed its entry so the
      // workspace shows at once instead of a loader.
      if (slug !== undefined && updated) {
        qc.setQueryData(workspaceKeys.bySlugs(updated.organization_slug, updated.slug), updated);
      }
      refreshWorkspace(qc, orgSlug, wsSlug);
    },
  });
}

export function useUploadWorkspaceIcon(orgSlug: string, wsSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wsId, file }: { wsId: string; file: File }) => workspaces.uploadWorkspaceIcon(wsId, file),
    onSuccess: () => refreshWorkspace(qc, orgSlug, wsSlug),
  });
}

export function useRemoveWorkspaceIcon(orgSlug: string, wsSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wsId }: { wsId: string }) => workspaces.removeWorkspaceIcon(wsId),
    onSuccess: () => refreshWorkspace(qc, orgSlug, wsSlug),
  });
}
