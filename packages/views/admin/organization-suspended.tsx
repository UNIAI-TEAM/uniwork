"use client";

import { useTranslation } from "react-i18next";
import type { Organization } from "@uniwork/core/types";
import { AccessNoticePage } from "./access-notice-page";

/**
 * What a member sees when their organization is suspended: every org and
 * workspace route answers 403 organization_suspended, so the shell shows
 * this instead of the page. Reason-free by design — the reason is between
 * the platform and the owner, not on every member's screen. The way out is
 * /get-started (ADR 0032): a suspended organization still holds its members
 * (D1), so that page offers only the invitations — a member may leave a
 * suspended organization on the way into another, never found a second one.
 *
 * The owner is the exception. Ownership of a suspended organization can be
 * neither transferred nor closed (the switch says "contact support"), so
 * joining another is closed to them too: they are told to contact support
 * and offered no link that would end at that refusal. The organization's
 * name and the caller's role come from the cached organization list; without
 * it the notice stays generic and offers the link.
 *
 * `loading` holds the shell's frame while the guard is still telling a
 * suspension from a closure.
 */
export function OrganizationSuspendedPage({
  organization,
  loading = false,
  announce = false,
}: {
  organization?: Pick<Organization, "name" | "role">;
  loading?: boolean;
  announce?: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.suspended" });
  if (loading) return <AccessNoticePage announce={announce} />;
  const owner = organization?.role === "owner";
  let description = t("description");
  if (organization) {
    description = owner
      ? t("owner_description", { name: organization.name })
      : t("description_named", { name: organization.name });
  }
  return (
    <AccessNoticePage
      title={t("title")}
      description={description}
      linkLabel={owner ? undefined : t("get_started_link")}
      announce={announce}
    />
  );
}
