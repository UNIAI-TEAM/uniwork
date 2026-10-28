import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as auth from "../api/endpoints/auth";
import * as links from "../api/endpoints/membership-invite-links";
import type { SwitchResolution } from "../types/workspace";
import { setSessionUser } from "../auth/hooks";
import { workspaceKeys } from "./keys";

export const membershipInviteKeys = {
  workspace: (wsId: string) => [...workspaceKeys.list(), "invite-links", wsId] as const,
  org: (orgSlug: string) => ["org-invite-links", orgSlug] as const,
  preview: (linkId: string) => ["membership-invite-preview", linkId] as const,
};

export function useWorkspaceInviteLinks(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: membershipInviteKeys.workspace(workspaceId),
    queryFn: () => links.listWorkspaceInviteLinks(workspaceId),
    enabled: enabled && !!workspaceId,
  });
}

export function useCreateWorkspaceInviteLink(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { expires_in_days?: number }) =>
      links.createWorkspaceInviteLink(workspaceId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membershipInviteKeys.workspace(workspaceId) });
    },
  });
}

export function useRevokeWorkspaceInviteLink(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => links.revokeWorkspaceInviteLink(workspaceId, linkId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membershipInviteKeys.workspace(workspaceId) });
    },
  });
}

export function useRegenerateWorkspaceInviteLink(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { expires_in_days?: number }) =>
      links.regenerateWorkspaceInviteLink(workspaceId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membershipInviteKeys.workspace(workspaceId) });
    },
  });
}

export function useOrgInviteLinks(orgSlug: string, enabled = true) {
  return useQuery({
    queryKey: membershipInviteKeys.org(orgSlug),
    queryFn: () => links.listOrgInviteLinks(orgSlug),
    enabled: enabled && !!orgSlug,
  });
}

export function useCreateOrgInviteLink(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { workspace_ids: string[]; expires_in_days?: number }) =>
      links.createOrgInviteLink(orgSlug, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membershipInviteKeys.org(orgSlug) });
    },
  });
}

export function useRevokeOrgInviteLink(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => links.revokeOrgInviteLink(orgSlug, linkId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membershipInviteKeys.org(orgSlug) });
    },
  });
}

export function useRegenerateOrgInviteLink(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, ...body }: { linkId: string; expires_in_days?: number }) =>
      links.regenerateOrgInviteLink(orgSlug, linkId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membershipInviteKeys.org(orgSlug) });
    },
  });
}

export function useMembershipInvitePreview(linkId: string, secret: string, enabled = true) {
  return useQuery({
    queryKey: membershipInviteKeys.preview(linkId),
    queryFn: () => links.previewMembershipInviteLink(linkId, secret),
    enabled: enabled && !!linkId && !!secret,
    retry: false,
  });
}

export function useJoinMembershipInviteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      linkId,
      secret,
      resolve,
    }: {
      linkId: string;
      secret: string;
      resolve?: SwitchResolution[];
    }) => links.joinMembershipInviteLink(linkId, secret, resolve),
    onSuccess: async () => {
      qc.clear();
      const user = await auth.me().catch(() => null);
      if (user) setSessionUser(user);
    },
  });
}
