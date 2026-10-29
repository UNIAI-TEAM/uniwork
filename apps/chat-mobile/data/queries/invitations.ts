// The invitations of an account without a workspace (spec §5.2): the ones waiting for its address, the one behind a
// link it opened, and the organizations it already belongs to (what an empty list says). Account-scoped, outside the
// chat keys, never kept on disk (data/query-persister.ts), and dropped with the account at sign-out.
import { queryOptions } from "@tanstack/react-query";
import { invitationsApi } from "../invitations/api";

export const invitationKeys = {
  mine: () => ["invitations", "mine"] as const,
  preview: (token: string) => ["invitations", "preview", token] as const,
  organizations: () => ["invitations", "organizations"] as const,
};

/** Asked again whenever the picker is looked at: an invitation sent a minute ago should be there. */
export const myInvitationsOptions = () =>
  queryOptions({
    queryKey: invitationKeys.mine(),
    queryFn: ({ signal }) => invitationsApi.mine(signal),
    staleTime: 0,
    // As the workspace list beside it (workspaces.ts): asked whatever the reachability probe says.
    networkMode: "offlineFirst",
  });

export const invitationPreviewOptions = (token: string) =>
  queryOptions({
    queryKey: invitationKeys.preview(token),
    queryFn: ({ signal }) => invitationsApi.preview(token, signal),
    staleTime: 0,
    // A refusal (gone, another account's, a suspended organization) is the answer, not a blip to retry.
    retry: false,
    networkMode: "offlineFirst",
  });

export const myOrganizationsOptions = () =>
  queryOptions({
    queryKey: invitationKeys.organizations(),
    queryFn: ({ signal }) => invitationsApi.organizations(signal),
    networkMode: "offlineFirst",
  });
