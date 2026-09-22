import type { MeetingInviteLink } from "@uniwork/core/types/meeting";

function inviteLinkLocale(language: string): string {
  return language.startsWith("vi") ? "vi-VN" : "en-US";
}

export function formatInviteLinkTimestamp(iso: string, language: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleString(inviteLinkLocale(language), {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function shortInviteLinkCode(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 6) return trimmed.toUpperCase();
  return trimmed.slice(-6).toUpperCase();
}

const GENERIC_INVITE_LINK_NAMES = new Set([
  "Liên kết mời",
  "Invite link",
  "Liên kết mới",
  "New link",
  "meetings.linkDefaultName",
]);

function isGenericInviteLinkName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return true;
  if (GENERIC_INVITE_LINK_NAMES.has(trimmed)) return true;
  return trimmed.startsWith("meetings.link");
}

type InviteLinkTranslate = (key: string, options?: Record<string, unknown>) => string;

/** Default label persisted on create — never store an i18n key in the database. */
export function defaultInviteLinkLabel(iso: string, language: string, t: InviteLinkTranslate): string {
  return t("meetings.linkDefaultName", { time: formatInviteLinkTimestamp(iso, language) });
}

export function inviteLinkDisplayName(link: MeetingInviteLink, language: string, t: InviteLinkTranslate): string {
  const code = shortInviteLinkCode(link.id);
  if (isGenericInviteLinkName(link.name)) {
    const label = defaultInviteLinkLabel(link.created_at ?? new Date().toISOString(), language, t);
    return `${label} · #${code}`;
  }
  return `${link.name.trim()} · #${code}`;
}

/** Access rule, created, expires, uses — each part its own i18n sentence. */
export function inviteLinkMetaParts(link: MeetingInviteLink, language: string, t: InviteLinkTranslate): string[] {
  const parts: string[] = [];
  parts.push(t(link.access_mode === "REQUEST_APPROVAL" ? "meetings.linkNeedApproval" : "meetings.linkAutoAdmit"));

  if (link.created_at) {
    const created = formatInviteLinkTimestamp(link.created_at, language);
    if (created) parts.push(t("meetings.linkMetaCreated", { time: created }));
  }

  const expires = formatInviteLinkTimestamp(link.expires_at, language);
  if (expires) parts.push(t("meetings.linkMetaExpires", { time: expires }));

  parts.push(
    link.max_uses != null
      ? t("meetings.linkMetaUsesLimit", { used: link.used_count, max: link.max_uses })
      : t("meetings.linkMetaUsesCount", { count: link.used_count }),
  );
  return parts;
}
