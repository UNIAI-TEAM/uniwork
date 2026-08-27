"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as workspaces from "../api/endpoints/workspaces";

export type { InviteResult } from "../api/endpoints/workspaces";

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

export const workspaceKeys = {
  list: () => ["workspaces"] as const,
  bySlugs: (orgSlug: string, wsSlug: string) => ["workspace", orgSlug, wsSlug] as const,
  members: (wsId: string) => ["members", wsId] as const,
  myInvitations: () => ["my-invitations"] as const,
};

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => workspaces.list(),
  });
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

export function useInvite(workspaceId: string) {
  return useMutation({
    mutationFn: (body: { emails: string[]; role: "admin" | "member" }) =>
      workspaces.invite(workspaceId, body),
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

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => workspaces.acceptInvite(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.list() }),
  });
}

export function usePatchWorkspace(orgSlug: string, wsSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wsId, name }: { wsId: string; name: string }) =>
      workspaces.patchWorkspace(wsId, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceKeys.list() });
      void qc.invalidateQueries({ queryKey: workspaceKeys.bySlugs(orgSlug, wsSlug) });
    },
  });
}
