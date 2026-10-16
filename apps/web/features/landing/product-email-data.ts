import type { EmailHubAccount, EmailHubThread } from "@uniwork/core/types/email-hub";
import { DEMO_MEMBERS, DEMO_PROFILE } from "./product-demo-data";

export const DEMO_MAILBOX: EmailHubAccount = {
  id: "landing-mailbox", email_address: DEMO_PROFILE.email, provider: "gmail",
  auth_kind: "oauth_google", connected_at: "2026-10-01T08:00:00Z",
  last_sync_at: "2026-10-16T04:10:00Z", needs_reconnect: false, auth_failed_reason: "",
};

const SENDERS = [
  [DEMO_MEMBERS[1]!.name, DEMO_MEMBERS[1]!.email], [DEMO_MEMBERS[2]!.name, DEMO_MEMBERS[2]!.email],
  ["Demo Studio", "team@uniwork.example"], [DEMO_MEMBERS[4]!.name, DEMO_MEMBERS[4]!.email],
  [DEMO_MEMBERS[5]!.name, DEMO_MEMBERS[5]!.email], ["Design team", "design@uniwork.example"],
  ["Product team", "product@uniwork.example"], ["Operations", "ops@uniwork.example"],
  [DEMO_MEMBERS[1]!.name, DEMO_MEMBERS[1]!.email], [DEMO_MEMBERS[2]!.name, DEMO_MEMBERS[2]!.email],
  [DEMO_MEMBERS[4]!.name, DEMO_MEMBERS[4]!.email], [DEMO_MEMBERS[5]!.name, DEMO_MEMBERS[5]!.email],
  ["Demo Studio", "team@uniwork.example"],
];

/** Fictional mail uses the production contract, never a visitor's connected inbox. */
export function demoEmailThreads(t: (key: string) => string): EmailHubThread[] {
  return SENDERS.map(([name, address], index) => ({
    id: `demo-mail-${index}`, account_id: DEMO_MAILBOX.id, folder: "INBOX",
    subject: t(`landing.productDemo.email.messages.${index}.subject`),
    snippet: t(`landing.productDemo.email.messages.${index}.snippet`),
    body_text: index === 0 ? `${t("landing.playback.mailGreeting")}\n\n${t("landing.playback.mailBodyOne")}\n\nAn Nhiên` : t(`landing.productDemo.email.messages.${index}.snippet`),
    from_name: name, from_addr: address!, to_addrs: [DEMO_MAILBOX.email_address],
    sent_at: `2026-10-${String(15 - Math.floor(index / 2)).padStart(2, "0")}T09:12:00Z`,
    is_read: index > 9, is_starred: index === 2, has_attachments: index === 0 || index === 4,
    attachments: index === 0 || index === 4 ? [{ id: `attachment-${index}`, filename: index === 0 ? "Launch-brief.pdf" : "Implementation-plan.pdf", mime_type: "application/pdf", size_bytes: 253952 }] : [],
    body_cached: true, imap_labels: [],
  }));
}
