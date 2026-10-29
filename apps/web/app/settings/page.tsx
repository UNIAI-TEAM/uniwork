"use client";

import { AccountSettingsView } from "@uniwork/views/settings";

/**
 * /settings: the account's own settings (spec §4.5). The view sends a person
 * with a workspace on to that workspace's settings, query kept, and stands on
 * its own for one without.
 */
export default function AccountSettingsPage() {
  return <AccountSettingsView />;
}
