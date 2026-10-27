import { z } from "zod";
import { OrganizationSchema, type Organization } from "../../types/organization";
import {
  MembershipConflictSchema,
  WorkspaceSchema,
  type SwitchResolution,
  type Workspace,
} from "../../types/workspace";
import { request } from "../http";
import { parseWithFallback } from "../schema";

export type { SwitchResolution };

const enc = encodeURIComponent;

const WorkspaceRefSchema = z.object({
  id: z.string(),
  slug: z.string().optional().default(""),
  name: z.string().optional().default(""),
});

const MembershipInviteLinkSchema = z.object({
  id: z.string(),
  organization_id: z.string().optional().default(""),
  workspace_id: z.string().optional().default(""),
  status: z.string().optional().default("active"),
  expires_at: z.string().optional().default(""),
  secret: z.string().optional().default(""),
  workspaces: z.array(WorkspaceRefSchema).optional().default([]),
  created_at: z.string().optional().default(""),
});

export type MembershipInviteLink = z.infer<typeof MembershipInviteLinkSchema>;

const LinkResponse = z.object({ invite_link: MembershipInviteLinkSchema });
const LinkListResponse = z.object({ invite_links: z.array(MembershipInviteLinkSchema) });

const PreviewSchema = z.object({
  link_id: z.string(),
  status: z.string().optional().default("active"),
  organization: z.object({
    id: z.string(),
    slug: z.string().optional().default(""),
    name: z.string().optional().default(""),
  }),
  workspaces: z
    .array(
      z.object({
        id: z.string(),
        slug: z.string().optional().default(""),
        name: z.string().optional().default(""),
        joined: z.boolean().optional().default(false),
      }),
    )
    .optional()
    .default([]),
  needs_join: z.boolean().optional().default(false),
  already_member: z.boolean().optional().default(false),
  conflicts: z.array(MembershipConflictSchema).optional().default([]),
});

export type MembershipInvitePreview = z.infer<typeof PreviewSchema>;

const JoinSchema = z.object({
  organization: OrganizationSchema,
  workspace: WorkspaceSchema.nullish(),
  joined_ids: z.array(z.string()).optional().default([]),
  already_all: z.boolean().optional().default(false),
});

export type MembershipInviteJoinResult = {
  organization: Organization | null;
  workspace: Workspace | null;
  joined_ids: string[];
  already_all: boolean;
};

async function parseLink(
  raw: unknown,
  endpoint: string,
): Promise<MembershipInviteLink | null> {
  return (
    parseWithFallback<{ invite_link: MembershipInviteLink } | null>(raw, LinkResponse, null, {
      endpoint,
    })?.invite_link ?? null
  );
}

export async function listWorkspaceInviteLinks(workspaceId: string): Promise<MembershipInviteLink[]> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/invite-links`);
  return parseWithFallback<{ invite_links: MembershipInviteLink[] }>(
    raw,
    LinkListResponse,
    { invite_links: [] },
    { endpoint: "GET /api/v1/workspaces/{id}/invite-links" },
  ).invite_links;
}

export async function createWorkspaceInviteLink(
  workspaceId: string,
  body?: { expires_in_days?: number },
): Promise<MembershipInviteLink | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/invite-links`, {
    method: "POST",
    body: body ?? {},
  });
  return parseLink(raw, "POST /api/v1/workspaces/{id}/invite-links");
}

export async function revokeWorkspaceInviteLink(
  workspaceId: string,
  linkId: string,
): Promise<MembershipInviteLink | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/invite-links/${enc(linkId)}/revoke`,
    { method: "POST" },
  );
  return parseLink(raw, "POST /api/v1/workspaces/{id}/invite-links/{linkID}/revoke");
}

export async function regenerateWorkspaceInviteLink(
  workspaceId: string,
  body?: { expires_in_days?: number },
): Promise<MembershipInviteLink | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/invite-links/regenerate`, {
    method: "POST",
    body: body ?? {},
  });
  return parseLink(raw, "POST /api/v1/workspaces/{id}/invite-links/regenerate");
}

export async function listOrgInviteLinks(orgSlug: string): Promise<MembershipInviteLink[]> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/invite-links`);
  return parseWithFallback<{ invite_links: MembershipInviteLink[] }>(
    raw,
    LinkListResponse,
    { invite_links: [] },
    { endpoint: "GET /api/v1/orgs/{org}/invite-links" },
  ).invite_links;
}

export async function createOrgInviteLink(
  orgSlug: string,
  body: { workspace_ids: string[]; expires_in_days?: number },
): Promise<MembershipInviteLink | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/invite-links`, { method: "POST", body });
  return parseLink(raw, "POST /api/v1/orgs/{org}/invite-links");
}

export async function revokeOrgInviteLink(
  orgSlug: string,
  linkId: string,
): Promise<MembershipInviteLink | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/invite-links/${enc(linkId)}/revoke`, {
    method: "POST",
  });
  return parseLink(raw, "POST /api/v1/orgs/{org}/invite-links/{linkID}/revoke");
}

export async function regenerateOrgInviteLink(
  orgSlug: string,
  linkId: string,
  body?: { expires_in_days?: number },
): Promise<MembershipInviteLink | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/invite-links/${enc(linkId)}/regenerate`, {
    method: "POST",
    body: body ?? {},
  });
  return parseLink(raw, "POST /api/v1/orgs/{org}/invite-links/{linkID}/regenerate");
}

export async function previewMembershipInviteLink(
  linkId: string,
  secret: string,
): Promise<MembershipInvitePreview | null> {
  const raw = await request("/api/v1/membership-invite-links/preview", {
    method: "POST",
    body: { link_id: linkId, secret },
  });
  return parseWithFallback<MembershipInvitePreview | null>(raw, PreviewSchema, null, {
    endpoint: "POST /api/v1/membership-invite-links/preview",
  });
}

export async function joinMembershipInviteLink(
  linkId: string,
  secret: string,
  resolve?: SwitchResolution[],
): Promise<MembershipInviteJoinResult> {
  const raw = await request("/api/v1/membership-invite-links/join", {
    method: "POST",
    body: { link_id: linkId, secret, ...(resolve?.length ? { resolve } : {}) },
  });
  const parsed = parseWithFallback<z.infer<typeof JoinSchema> | null>(raw, JoinSchema, null, {
    endpoint: "POST /api/v1/membership-invite-links/join",
  });
  return {
    organization: parsed?.organization ?? null,
    workspace: parsed?.workspace ?? null,
    joined_ids: parsed?.joined_ids ?? [],
    already_all: parsed?.already_all ?? false,
  };
}
