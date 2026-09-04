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

/** Default label persisted on create — never store an i18n key in the database. */
export function defaultInviteLinkLabel(iso: string, language: string): string {
  const time = formatInviteLinkTimestamp(iso, language);
  return language.startsWith("vi") ? `Liên kết ${time}` : `Link ${time}`;
}

export function inviteLinkDisplayName(link: MeetingInviteLink, language: string): string {
  const code = shortInviteLinkCode(link.id);
  const created = link.created_at ? formatInviteLinkTimestamp(link.created_at, language) : "";
  if (isGenericInviteLinkName(link.name)) {
    const label = created ? defaultInviteLinkLabel(link.created_at!, language) : defaultInviteLinkLabel(new Date().toISOString(), language);
    return `${label} · #${code}`;
  }
  return `${link.name.trim()} · #${code}`;
}

type InviteLinkMetaLabels = {
  created: (time: string) => string;
  expires: (time: string) => string;
  uses: (used: number, max?: number) => string;
  accessAuto: string;
  accessApproval: string;
};

function inviteLinkMetaLabels(language: string): InviteLinkMetaLabels {
  const isVi = language.startsWith("vi");
  return {
    created: (time) => (isVi ? `Tạo ${time}` : `Created ${time}`),
    expires: (time) => (isVi ? `Hết hạn ${time}` : `Expires ${time}`),
    uses: (used, max) =>
      max != null
        ? isVi
          ? `${used}/${max} lượt`
          : `${used}/${max} uses`
        : isVi
          ? `${used} lượt dùng`
          : `${used} uses`,
    accessAuto: isVi ? "Tự động cho phép" : "Admit automatically",
    accessApproval: isVi ? "Cần chủ trì duyệt" : "Host must approve",
  };
}

export function inviteLinkMetaParts(
  link: MeetingInviteLink,
  language: string,
  labels: InviteLinkMetaLabels = inviteLinkMetaLabels(language),
): string[] {
  const parts: string[] = [];
  const access =
    link.access_mode === "REQUEST_APPROVAL" ? labels.accessApproval : labels.accessAuto;
  parts.push(access);

  if (link.created_at) {
    const created = formatInviteLinkTimestamp(link.created_at, language);
    if (created) parts.push(labels.created(created));
  }

  const expires = formatInviteLinkTimestamp(link.expires_at, language);
  if (expires) parts.push(labels.expires(expires));

  parts.push(labels.uses(link.used_count, link.max_uses));
  return parts;
}
