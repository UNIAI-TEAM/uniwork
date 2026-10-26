function inviteLinkLocale(language: string): string {
  return language.startsWith("vi") ? "vi-VN" : "en-US";
}

function formatInviteLinkTimestamp(iso: string, language: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleString(inviteLinkLocale(language), {
    dateStyle: "short",
    timeStyle: "short",
  });
}

type InviteLinkTranslate = (key: string, options?: Record<string, unknown>) => string;

/** Default label persisted on create — never store an i18n key in the database. */
export function defaultInviteLinkLabel(iso: string, language: string, t: InviteLinkTranslate): string {
  return t("meetings.linkDefaultName", { time: formatInviteLinkTimestamp(iso, language) });
}
