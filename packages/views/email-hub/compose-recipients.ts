import type { EmailHubThread } from "@uniwork/core/types/email-hub";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export function replySubject(subject: string) {
  const trimmed = subject.trim();
  if (!trimmed) return "";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function forwardSubject(subject: string) {
  const trimmed = subject.trim();
  if (!trimmed) return "";
  return /^fwd:/i.test(trimmed) ? trimmed : `Fwd: ${trimmed}`;
}

function normalizeEmail(addr: string) {
  return addr.trim().toLowerCase();
}

export function buildReplyAllRecipients(thread: EmailHubThread, fromEmail: string | null) {
  const self = normalizeEmail(fromEmail ?? "");
  const seen = new Set<string>();
  const to: string[] = [];
  const cc: string[] = [];

  const add = (addr: string, bucket: string[]) => {
    const lower = normalizeEmail(addr);
    if (!lower || lower === self || seen.has(lower)) return;
    seen.add(lower);
    bucket.push(addr.trim());
  };

  add(thread.from_addr, to);
  for (const addr of thread.to_addrs ?? []) {
    add(addr, cc);
  }
  return { to: to.join(", "), cc: cc.join(", ") };
}

export function buildForwardBody(thread: Pick<EmailHubThread, "from_addr" | "from_name" | "sent_at" | "subject" | "body_text">) {
  const from = thread.from_name ? `${thread.from_name} <${thread.from_addr}>` : thread.from_addr;
  const when = new Date(thread.sent_at).toLocaleString();
  const quoted = thread.body_text?.trim() ?? "";
  return `\n\n---------- Forwarded message ----------\nFrom: ${from}\nDate: ${when}\nSubject: ${thread.subject}\n\n${quoted}`;
}

export function composeModeTitleKey(mode: ComposeMode) {
  switch (mode) {
    case "reply":
      return "email_hub.compose.reply_title";
    case "replyAll":
      return "email_hub.compose.reply_all_title";
    case "forward":
      return "email_hub.compose.forward_title";
    default:
      return "email_hub.compose.title";
  }
}

export function composeModeDescriptionKey(mode: ComposeMode) {
  switch (mode) {
    case "reply":
      return "email_hub.compose.reply_description";
    case "replyAll":
      return "email_hub.compose.reply_all_description";
    case "forward":
      return "email_hub.compose.forward_description";
    default:
      return "email_hub.compose.description";
  }
}
