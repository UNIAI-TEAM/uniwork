"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { MemberSchema, PendingInvitationSchema, WorkspaceSchema, type Workspace } from "../types";

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

const WorkspacesResponse = z.object({ workspaces: z.array(WorkspaceSchema) });
const WorkspaceResponse = z.object({ workspace: WorkspaceSchema });
const MembersResponse = z.object({ members: z.array(MemberSchema) });

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.request("/api/v1/workspaces", { schema: WorkspacesResponse }),
    select: (d) => d.workspaces,
  });
}

export function useWorkspace(orgSlug: string, wsSlug: string) {
  return useQuery({
    queryKey: ["workspace", orgSlug, wsSlug],
    queryFn: () =>
      api.request(`/api/v1/orgs/${orgSlug}/workspaces/${wsSlug}`, { schema: WorkspaceResponse }),
    select: (d) => d.workspace,
    enabled: !!orgSlug && !!wsSlug,
    retry: false,
  });
}

export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () =>
      api.request(`/api/v1/workspaces/${workspaceId}/members`, { schema: MembersResponse }),
    select: (d) => d.members,
    enabled: !!workspaceId,
  });
}

const InviteResponse = z.object({
  invitations: z.array(
    z.object({ id: z.string(), email: z.string(), role: z.string(), token: z.string() }),
  ),
  skipped: z.array(z.string()),
});

export function useInvite(workspaceId: string) {
  return useMutation({
    mutationFn: ({ emails, role }: { emails: string[]; role: "admin" | "member" }) =>
      api.request(`/api/v1/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        body: { emails, role },
        schema: InviteResponse,
      }),
  });
}

const MyInvitationsResponse = z.object({ invitations: z.array(PendingInvitationSchema) });

export function useMyInvitations(enabled = true) {
  return useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => api.request("/api/v1/me/invitations", { schema: MyInvitationsResponse }),
    select: (d) => d.invitations,
    enabled,
  });
}

export function fetchMyInvitations() {
  return api
    .request("/api/v1/me/invitations", { schema: MyInvitationsResponse })
    .then((d) => d.invitations);
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.request<{ workspace: Workspace }>(`/api/v1/invitations/${token}/accept`, {
        method: "POST",
        schema: WorkspaceResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}
