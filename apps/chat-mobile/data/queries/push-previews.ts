// The organization's rule for message text in chat pushes (GET
// /api/v1/orgs/{org}/push-preview-policy): Settings greys the person's own
// switch and says why when the organization hides it. Org-scoped, like the
// organization's members (org-members.ts).
import { queryOptions } from "@tanstack/react-query";
import { accountApi } from "../account-api";

const pushPreviewKeys = {
  policy: (orgSlug: string) => ["org", orgSlug, "push-preview-policy"] as const,
};

export const pushPreviewPolicyOptions = (orgSlug: string) =>
  queryOptions({
    queryKey: pushPreviewKeys.policy(orgSlug),
    queryFn: ({ signal }) => accountApi.pushPreviewPolicy(orgSlug, signal),
    staleTime: 5 * 60_000,
  });
