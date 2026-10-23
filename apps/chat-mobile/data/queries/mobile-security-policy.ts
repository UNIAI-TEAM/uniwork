// The organization's floor under the phone's app lock and screen-capture
// choices (GET /api/v1/orgs/{org}/mobile-security-policy; audit "Security &
// privacy", privacy-defaults-off): components/app/use-privacy-floor.ts hands it
// to the privacy settings. Org-scoped, like the push preview policy
// (push-previews.ts). Read again when the app comes back to the front, so a
// requirement an admin just set reaches a phone that stays open.
import { queryOptions } from "@tanstack/react-query";
import { accountApi } from "../account-api";

export const mobileSecurityPolicyOptions = (orgSlug: string) =>
  queryOptions({
    queryKey: ["org", orgSlug, "mobile-security-policy"] as const,
    queryFn: ({ signal }) => accountApi.mobileSecurityPolicy(orgSlug, signal),
    staleTime: 5 * 60_000,
  });
