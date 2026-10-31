// The invitations an account without a workspace answers on the phone (spec §5.2): the ones waiting for its address
// (GET /api/v1/me/invitations), the one behind a link it opened (GET /api/v1/invitations/{token}), joining one (POST
// /api/v1/invitations/{token}/accept), and whether it already belongs to an organization (GET /api/v1/orgs), which
// decides what an empty list says. The schemas are core's (types/workspace, types/organization), so the phone reads
// an invitation exactly as the web does. A list that does not parse is null, never []: an empty list tells the person
// nobody invited them, which a drifted answer must not say. api.test.ts holds a malformed-response case for each.
import { parseWithFallback } from "@uniwork/core/api/schema";
import { OrganizationSchema, type Organization } from "@uniwork/core/types/organization";
import {
  InvitationPreviewSchema,
  PendingInvitationSchema,
  type InvitationPreview,
  type PendingInvitation,
  type Workspace,
} from "@uniwork/core/types/workspace";
import { z } from "zod";
import { api } from "../api";
import { WorkspaceSchema } from "../schemas";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

const MyInvitationsSchema = z.object({ invitations: z.array(PendingInvitationSchema) });
/** GET /api/v1/orgs (data/server-contract.test.ts holds it to the server's SDO, as AcceptedSchema). */
export const OrganizationsSchema = z.object({ organizations: z.array(OrganizationSchema) });
export const AcceptedSchema = z.object({
  organization: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  // Absent while no workspace was granted (UNI-1472): the person is in the organization with nowhere to land yet.
  workspace: WorkspaceSchema.optional().catch(undefined),
});

/** Where joining led: the organization, and the workspace to open when one was granted. */
export interface Accepted {
  organization: { id: string; slug: string; name: string };
  workspace: Workspace | null;
}

const enc = encodeURIComponent;

export function createInvitationsApi(request: Request) {
  return {
    /** The invitations waiting for the account's address, or null when the answer did not parse. */
    async mine(signal?: AbortSignal): Promise<PendingInvitation[] | null> {
      const raw = await request("/api/v1/me/invitations", { signal });
      return parseWithFallback<{ invitations: PendingInvitation[] } | null>(raw, MyInvitationsSchema, null, {
        endpoint: "GET /api/v1/me/invitations",
      })?.invitations ?? null;
    },
    /** The invitation behind a link, in any state, and what stands between the account and it; null when it drifted. */
    async preview(token: string, signal?: AbortSignal): Promise<InvitationPreview | null> {
      const raw = await request(`/api/v1/invitations/${enc(token)}`, { signal });
      return parseWithFallback<InvitationPreview | null>(raw, InvitationPreviewSchema, null, {
        endpoint: "GET /api/v1/invitations/{token}",
      });
    },
    /**
     * Joins the organization and the workspaces the invitation grants. No body: the phone never resolves another
     * organization (the switch is the web's, 409 organization_switch_required). Null when the answer drifted: the
     * person did join, and the caller reads the workspace list again to find where.
     */
    async accept(token: string): Promise<Accepted | null> {
      const raw = await request(`/api/v1/invitations/${enc(token)}/accept`, { method: "POST" });
      const parsed = parseWithFallback<z.infer<typeof AcceptedSchema> | null>(raw, AcceptedSchema, null, {
        endpoint: "POST /api/v1/invitations/{token}/accept",
      });
      return parsed && { organization: parsed.organization, workspace: parsed.workspace ?? null };
    },
    /** The organizations the account belongs to, or null when the answer did not parse. */
    async organizations(signal?: AbortSignal): Promise<Organization[] | null> {
      const raw = await request("/api/v1/orgs", { signal });
      return parseWithFallback<{ organizations: Organization[] } | null>(raw, OrganizationsSchema, null, {
        endpoint: "GET /api/v1/orgs",
      })?.organizations ?? null;
    },
  };
}

export type InvitationsApi = ReturnType<typeof createInvitationsApi>;

export const invitationsApi: InvitationsApi = createInvitationsApi((path, init) => api.request(path, init));
