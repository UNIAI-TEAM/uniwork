"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { MemberSchema, WorkspaceSchema, type Workspace } from "../types";

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

export function useWorkspace(slug: string) {
  return useQuery({
    queryKey: ["workspace", slug],
    queryFn: () => api.request(`/api/v1/workspaces/${slug}`, { schema: WorkspaceResponse }),
    select: (d) => d.workspace,
    enabled: !!slug,
    retry: false,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, slug }: { name: string; slug: string }) =>
      api.request("/api/v1/workspaces", {
        method: "POST",
        body: { name, slug },
        schema: WorkspaceResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
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
  invitation: z.object({ id: z.string(), email: z.string(), role: z.string(), token: z.string() }),
});

export function useInvite(workspaceId: string) {
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: "admin" | "member" }) =>
      api.request(`/api/v1/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        body: { email, role },
        schema: InviteResponse,
      }),
  });
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
